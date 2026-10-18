# Direct Cloudflare deployment

The active application is deployed to Cloudflare Workers using OpenNext. Neon provides PostgreSQL and authentication. The public address stays https://bunyra-new.sayedelsenosy65.workers.dev.

Cloudflare Builds:
- Build: npm run build:cloudflare
- Deploy: npm run deploy:cloudflare
- Config: wrangler.jsonc
- Required production secrets: DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET, PLATFORM_OWNER_EMAIL.
- ALLOW_OWNER_BOOTSTRAP is temporary and must be false after first verified owner initialization.

The old hosting/cloudflare-gateway.mjs and wrangler.gateway.jsonc are retained as historical rollback source, not the active deployment configuration. Netlify publication is paused by its free-tier deployment credit limit. Never commit secrets or use production fixtures for tests.

TypeScript checks pass locally. OpenNext packaging runs in Cloudflare Linux Builds because the local Windows adapter failed to resolve its config path. Production /api/health now checks a real database query rather than only the presence of environment variables.
