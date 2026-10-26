# Phase 3 — Treasury & aging

- /treasury?company=<uuid> provides company-scoped receipt filtering (method, status, local Cairo date), 20-row pages, today's posted collections grouped by contract currency, pending and bounced cheque counts.
- /reports/aging?company=<uuid> groups still-outstanding past-due amounts by customer and currency, with 1–30, 31–60 and >60-day buckets. It does not mix different currencies and does not count future-due installments.
- POST /api/receipts/[id]/cheque-status with action BOUNCED and nonempty reason calls the BUNYRA Neon/managed identity service, validates finance access and project scope, and appends a cheque event. Migration 069's AFTER INSERT trigger atomically sets an unpaid installment status to overdue, without modifying paid_minor or posting money for bounced pending cheques.
- With action CLEARED and a matching payment account, the existing recordCollection handles the posted collection, installment amount and append-only CLEARED event atomically.
- The receipt's base fields stay append-only; receipt_status derives the current cheque status.
- Do not apply migration 069 in a different DB before 067 and 068. It changes contract_installments_status_check.
- SQL integration tests need the isolated Neon staging branch and should verify trigger behavior and the retained zero payment amount.
- Playwright: install Chromium with `npx playwright install chromium` and set E2E_BASE_URL to the staging site, E2E_COMPANY_USERNAME and E2E_COMPANY_PASSWORD to a disposable authorized finance account, E2E_COMPANY_ID, E2E_CONTRACT_ID, E2E_INSTALLMENT_ID (an unpaid fixture installment), E2E_READONLY_DATABASE_URL (isolated fixture database) and E2E_ALLOW_MUTATION=isolated-neon-staging. Run `npm run test:e2e:treasury`. Never run the mutating test against production.
- The Playwright script is deliberately gated. A skipped test is NOT a passed E2E; CI TypeScript/source checks are not a substitute for executing a browser test on a fixture site.

## Validation on 2026-10-26

- Migration 069 successfully applied to the existing isolated Neon `accounting-rehearsal-20261023` branch.
- Database integration: generated a disposable company, project, unit, approved booking, contract, installment, pending cheque and BOUNCED event. Assertion passed: installment becomes `overdue`, `paid_minor` remains zero, `receipt_cheque_events` contains exactly one terminal BOUNCED entry and `collections` remains empty. The entire fixture was rolled back using a savepoint.
- Production Neon `br-muddy-recipe-ba50akka`: applied 069 transactionally, verified migration marker and trigger. Prior snapshot `pre-phase067-068-2026-10-26` exists; **Neon refused an additional snapshot because the project snapshot quota was reached**. Do not claim a fresh snapshot was created for 069.
- Browser Playwright E2E is authored but not yet executed with staging login credentials. A skipped browser test does not mean success.
