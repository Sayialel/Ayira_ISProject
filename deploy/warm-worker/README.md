# ayira-keepwarm

The Cloudflare cron Worker that pings the two Render services so they are
awake when someone opens the site. Render's free instances spin down after
about fifteen minutes idle, and waking the engine is a cold container plus a
model load, during which requests get a 502.

Deployed at https://ayira-keepwarm.ayiraventures.workers.dev — opening it runs
the same check on demand, which is what to do before a demonstration outside
the scheduled window.

## Why this has its own package.json

It is not part of the application build, and keeping it separate is not
tidiness. Wrangler 3 pins `esbuild` to exactly `0.17.19`, while `tsx` — which
the gateway uses in development — wants `~0.28.0`. With both in the root
workspace, npm hoisted wrangler's `@esbuild/*` binaries under tsx's
`esbuild@0.28.2`, so esbuild's postinstall found the wrong binary and threw
`Expected "0.28.2" but got "0.17.19"`. That failed `npm ci` on every CI run
before a single test executed.

This directory is outside the `workspaces` globs in the root `package.json`,
so it installs on its own and its esbuild never meets the application's.

## Deploying it

```bash
cd deploy/warm-worker
npm install
npx wrangler login     # once
npm run deploy
npm run tail           # watch it fire
```

The schedule is in `wrangler.toml`. The window is deliberate: two free Render
services pinged 24/7 would need 1,460 instance-hours a month against a 750
allowance, so it runs 06:00–17:59 UTC — 09:00 to 21:00 in Nairobi — which
comes to 720.
