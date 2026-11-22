# Chartmates (friend-chart)

A friend group alignment chart, voted by the group: https://pb-friend-chart.pages.dev

- `public/` static site (Cloudflare Pages); `public/lib/` rules and themes shared by browser and server.
- `functions/` Pages Functions: `/api/*` (JSON API) and `/c/:id` (chart page with live link preview).
- `worker/` Worker `pb-friend-chart-db`: Durable Objects (one per chart + one for rate limits and counts).
- `lib/store.js` chart state machine. `docs/` GitHub Pages about/privacy page.

Dev: `pnpm dev:db` and `pnpm dev` (with `TEST_HOOKS=1` in `.dev.vars` / `worker/.dev.vars`), then
`pnpm test:unit` and `pnpm test:e2e` (real Chromium: phone touch, keyboard, overlap and 360 px checks; screenshots in `shots/`) (`BASE=https://pb-friend-chart.pages.dev` for production).
Deploy: `cd worker && wrangler deploy`, then `wrangler pages deploy public --project-name pb-friend-chart --branch main`.
