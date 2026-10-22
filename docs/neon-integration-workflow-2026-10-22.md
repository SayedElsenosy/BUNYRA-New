# Isolated Neon integration tests from GitHub Actions

This opt-in workflow runs the existing BUNYRA integration suites against a fixture-only Neon branch. It is never triggered automatically by pushes, and it never deploys the application.

## One-time repository setup

1. In Neon, choose the BUNYRA New project, branch `dev-foundation`, database `neondb`. Confirm the branch is for fixtures and not the production `main` branch.
2. In GitHub, open the repository's **Settings → Secrets and variables → Actions**, add a repository secret named `BUNYRA_TEST_DATABASE_URL`. Paste the connection string for the Neon **dev-foundation** branch into GitHub secret settings only; never commit the value, paste it in a chat, or use the production URL.
3. Open **Actions → BUNYRA Neon Integration (isolated) → Run workflow** and select `main` as the code version.

The workflow first runs the central safety preflight. It refuses missing opt-in, non-PostgreSQL URLs, and a database whose only platform-owner record is not exactly `identity-test-platform-owner`. The marker has been checked on dev-foundation; it is absent on production main. Failure of the preflight stops the run before fixture creation.

## Included suites

- Tenant isolation (`test:tenancy`).
- Collections, settlements, reversals, booking documents (`test:finance`).
- End-to-end booking and contract integrity, parallel adjustments (`test:commercial-integrity`).
- Commission posting, eligibility, and reporting bounds (`test:commissions-reports`).

All suites may write synthetic records to the *test* branch. They do not clean up production, modify main's database schema or touch Cloudflare settings. Tests are intentionally manual to control database usage and running costs.

The standard push CI remains database-free. A successful Cloudflare build is not proof of a live deployment. A genuine backup/restore drill and high-load tests remain separate work.
