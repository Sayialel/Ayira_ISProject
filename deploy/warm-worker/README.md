# ayira-keepwarm

The Cloudflare cron Worker that pings the two Render services so they are
awake when someone opens the site. Render's free instances spin down after
about fifteen minutes idle, and waking the engine is a cold container plus a
model load, during which requests get a 502.

Deployed at https://ayira-keepwarm.ayiraventures.workers.dev — opening it runs
the same check on demand, which is what to do before a demonstration outside
the scheduled window.

Deployed from the parent directory, which holds wrangler:

```bash
cd deploy
npm install
npm run warm          # deploy
npm run warm:tail     # watch it fire
```

The schedule is in `wrangler.toml`. The window is deliberate: two free Render
services pinged 24/7 would need 1,460 instance-hours a month against a 750
allowance, so it runs 06:00–17:59 UTC — 09:00 to 21:00 in Nairobi — which
comes to 720.
