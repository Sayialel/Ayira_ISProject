# Deploying Ayira the simple way

## Before anything: the frontend does not deploy itself

The Cloudflare Pages project **ayiraventures** is a *direct-upload* project,
not a Git-connected one. Nothing happens when you push. Two commits went by
unnoticed before this was spotted, and because neither changed anything under
`apps/web` the live bundle happened to still be correct -- which is luck, not
a pipeline.

```bash
cd deploy && npm install && npm run pages
```

That one command builds *and* uploads, and it is the only way the frontend
should be deployed. `npm run warm` deploys the keep-warm Worker.

### Why it builds as well as uploads

Building and uploading used to be two steps, and that cost an outage. The
bundle was rebuilt without `VITE_API_URL` in the shell and uploaded over a
working one. `lib/api.ts` falls back to the relative `/api` when that variable
is unset -- correct in development, where the dev server proxies it to port
3001 -- so the deployed site asked *itself* for data. Pages answers
`/api/anything` with `index.html` and a 200, so every request succeeded and
returned HTML where the caller expected JSON. Gigs and profiles simply did not
load, and nothing was wrong in any server log: the gateway never saw a single
request.

Two guards now stand against it. `npm run pages` sets the variable itself, so
the build cannot drift from the upload. And `apps/web/vite.config.ts` throws on
a production build with `VITE_API_URL` unset, so the mistake fails loudly at
build time instead of quietly in front of a user.

### Why wrangler lives there and not in the root

Wrangler 3 pins `esbuild` to exactly `0.17.19`; `tsx`, which the gateway uses
in development, wants `~0.28.0`. With both in the root workspace npm hoisted
wrangler's `@esbuild/*` binaries under tsx's `esbuild@0.28.2`, so esbuild's
postinstall found the wrong binary and threw `Expected "0.28.2" but got
"0.17.19"` -- which failed `npm ci` on every CI run before a test executed.
`deploy/` is outside the `workspaces` globs, so its esbuild never meets the
application's.

Three free services, no credit card, no Docker knowledge, no AWS. Each one is
connected to GitHub and redeploys when you push.

| Piece | Host | Why this one |
|---|---|---|
| `apps/web` | **Cloudflare Pages** | It is a static bundle. Pages serves static bundles, free, with HTTPS and a global CDN |
| `apps/api` | **Render** | Express needs a Node process. Render runs one from the repo with no Dockerfile required |
| `apps/ai-engine` | **Hugging Face Spaces** | The encoder needs real memory. The free Space gives 2 vCPU and 16 GB |

Supabase is already hosted — Postgres, Auth and storage need no deployment.

---

## Why not AWS ECS

It works, and it is what the Sprint III brief shows, but for this project it
is three days of VPC, IAM, ECR, task definitions and load balancers to run two
small containers. It also bills by the hour whether anyone visits or not, and
student credit is not a spending cap.

The route below is free, takes about an hour, and produces the same thing: a
public HTTPS address with the real backend, database and model behind it.
**If an examiner asks why not AWS, that is the answer** — the simpler route
met the requirement, so the complexity was not bought.

## The one real constraint

The matching engine loads `all-MiniLM-L6-v2` through sentence-transformers,
which pulls in PyTorch. Measured on the project's own virtual environment:
**1.3 GB installed, of which PyTorch is 539 MB.** Disk is not memory, but a
dependency that size does not run in a small instance.

**Render's free tier is 256–512 MB**, so the engine will not fit there. The
gateway will: Express plus the Supabase client is light. Hugging Face's free
CPU Space is 2 vCPU and 16 GB, which is why the engine goes there — and it is
Example 3 in the brief, so it is already an approved route.

---

## 1. The frontend → Cloudflare Pages

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers &
   Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick the repository, production branch `main`.
3. Build settings:

   | Field | Value |
   |---|---|
   | Framework preset | Vite |
   | Build command | `npm run build --workspace=apps/web` |
   | Build output directory | `apps/web/dist` |
   | Root directory | *(leave blank — the build runs from the repo root)* |

4. Environment variables — these are baked into the bundle at build time,
   because a static file has no runtime environment:

   ```
   VITE_API_URL           https://<your-render-service>.onrender.com/api
   VITE_SUPABASE_URL      https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY <the anon key>
   ```

   The anon key is public by design and guarded by row-level security. **The
   service-role key must never appear here.**

5. Deploy, then open the `*.pages.dev` address.

You will not have the API URL yet on the first pass. Deploy once to get the
site up, do step 2, then come back and set `VITE_API_URL` and redeploy.

## 2. The gateway → Render

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Web
   Service** → connect the repository.
2. Render reads [`render.yaml`](render.yaml) at the repository root if you use
   **New → Blueprint** instead, which sets everything below for you. Either
   works; the Blueprint is fewer clicks.
3. Manual settings, if you are not using the Blueprint:

   | Field | Value |
   |---|---|
   | Runtime | Node |
   | Build command | `npm ci && npm run build --workspace=apps/api` |
   | Start command | `node apps/api/dist/index.js` |
   | Health check path | `/health` |

4. Environment variables:

   ```
   SUPABASE_URL
   SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   AI_ENGINE_URL             https://<user>-ayira-engine.hf.space
   AI_ENGINE_SECRET          the same value as the Space secret
   AI_ENGINE_TIMEOUT_MS      90000
   DARAJA_CONSUMER_KEY
   DARAJA_CONSUMER_SECRET
   DARAJA_PASSKEY
   DARAJA_SHORTCODE
   DARAJA_CALLBACK_URL       https://<render-service>.onrender.com/api/escrow/callback
   DARAJA_ENV                sandbox
   ```

   `AI_ENGINE_TIMEOUT_MS` is raised to 90 s because a sleeping Space takes
   longer to answer its first request than a warm container does.

## 3. The engine → Hugging Face Space

1. [huggingface.co/new-space](https://huggingface.co/new-space) → name it
   `ayira-engine`, **SDK: Docker**, visibility **Public** (free CPU tier).
2. Copy these three files from [`huggingface-space/`](huggingface-space/) into
   the Space repository:

   - `README.md` — the YAML header tells the Space which port to expose
   - `Dockerfile` — same release image as `apps/ai-engine/Dockerfile`, with the
     port changed to the 7860 that Spaces expects
   - `.gitattributes` — optional, only if you add large files later

   You also need the engine's source. The simplest way is to add this
   repository as a second remote and push `apps/ai-engine` into the Space, or
   just copy `app/`, `artifacts/` and `requirements.txt` across. The Dockerfile
   expects all three at the Space root.

3. **Settings → Variables and secrets**, add as *secrets*:

   ```
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   AI_ENGINE_SECRET
   ```

   A public Space shows its code. Secrets are not in the code, and the engine
   refuses to start serving without `AI_ENGINE_SECRET`, so a public Space is
   not an open door — but do not paste keys into any file you push there.

4. Wait for the build (the first one is slow; it downloads the encoder). The
   Space address is `https://<user>-ayira-engine.hf.space`.

5. Check it: `https://<user>-ayira-engine.hf.space/health` should return 200.

## 4. Join them up

1. Put the Space URL into Render as `AI_ENGINE_URL`.
2. Put the Render URL into Cloudflare Pages as `VITE_API_URL`, redeploy.
3. In Supabase → **Authentication → URL Configuration**, set `site_url` to the
   Pages address and add it to the redirect allow-list.
4. In Google Cloud → **Credentials**, add the Supabase callback to the OAuth
   client's authorised redirect URIs if it is not already there.
5. Smoke-test: sign in, run a match, post a gig, fund an escrow.

---

## What free costs you

**Everything sleeps.** Render free services spin down after about 15 minutes
idle; Spaces sleep too. The first request after that pays a cold start, and
for the engine that also means loading the encoder.

**Before a demonstration, wake both** a few minutes ahead:

```bash
curl https://<render-service>.onrender.com/health
curl https://<user>-ayira-engine.hf.space/health
```

Then run one real match so the model is in memory. A sleeping service is the
most likely way a live demonstration goes wrong, and it is entirely avoidable.

If sleeping is unacceptable for the assessment window, Render's paid tier is
about $7/month per service and removes the spin-down. One month covers it.

## Recording it for Chapter 5

Whatever route you take, record: the live URLs, the commit SHA deployed, the
model artefact (`artifacts/deployed.json` gives run id, dataset version and
fitted split), and the smoke-test results. That is what makes the deployment
evidence rather than an assertion.
