# Cloudflare access gateway

The application runs on Netlify with Neon. The fixed upstream gateway provides an alternate public address when the Netlify network cannot be reached locally.

- Worker: bunyra-new
- Expected URL: https://bunyra-new.sayedelsenosy65.workers.dev
- Source: hosting/cloudflare-gateway.mjs
- Build command: empty
- Deploy command: npx wrangler deploy --config hosting/wrangler.gateway.jsonc
- Runtime database/auth secrets remain exclusively on Netlify. The gateway forwards HTTPS requests, including login requests and session cookies, to the fixed BUNYRA Netlify upstream and does not log request bodies.
- Add the Worker origin to Neon Auth trusted domains.
- This remains dependent on Netlify availability and both free-tier quotas. It is not a standalone application migration.
- Never point arbitrary client-selected upstreams at this gateway.

Deployment and real HTTP/auth validation must be confirmed separately from source preparation.
