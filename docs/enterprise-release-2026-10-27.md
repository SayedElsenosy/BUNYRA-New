# Production release — 27 October 2026

- Hardening changes merged in PR37, commit506b0d3; shared DOCX renderer and latest staff-scoped lists from main were preserved.
- Production Neon `odd-fire-18298965`, branch `br-muddy-recipe-ba50akka`, upgraded from070 to073 in one transaction. An initial prepared-statement submission was rejected and rolled back; the successful transaction used individually parsed statements.
- All91 existing business-table fingerprints matched before and after inside the activation transaction. No production fixtures were inserted. Tenant execution of the unchecked internal adjustment function is revoked; the checked wrapper remains executable.
- Neon branch and snapshot quotas prevented creating a fresh provider backup. A private logical data export was retained outside Git; a PostgreSQL18 isolated local restoration/rehearsal preserved all91 business tables, then passed50 SQL security checks. This local copy is not an independently managed durable backup or a complete disaster-recovery guarantee.
- GitHub validation passed61 service security checks, all50 PostgreSQL checks and the existing regression checks, TypeScript, Cloudflare build and dry-run packaging.
- Release marker: `2026-10-27-enterprise-hardening`; schema073.
- Production publication and HTTP verification run: https://github.com/SayedElsenosy/BUNYRA-New/actions/runs/40462937970

## Operational limits

The deployed changes address the first hardening batch, not the entire enterprise roadmap. Legacy contract reissuance, durable external backups/recovery, SSO/MFA, dependency upgrades and remaining upload/notification/performance work remain separately tracked. Existing pre073 contracts never receive fabricated historical signing snapshots.

## Verified publication

Cloudflare deployed version `e4489e6e-3ff3-4e85-bb40-21bb88c932a4` on 27 October2026 at06:49UTC. The release workflow verified the live endpoint: health200, expected enterprise-hardening marker/schema073, anonymous session401. Verification ran from GitHub's deployment runner because this workspace's egress policy blocks the public Worker URL. Release pipeline changes merged through PR38.
