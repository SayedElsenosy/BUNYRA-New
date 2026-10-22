# Fixed assets and monthly depreciation — foundation (2026-10-22)

- Migration 044 adds an immutable asset register, month-by-month posted depreciation references and a tenant-scoped posting function. Company, legal entity, project and account mappings are enforced via foreign keys and explicit checks.
- Depreciation uses EGP integer minor units, straight-line cost less residual, with the remainder allocated to early months. No rounding loss.
- Each monthly posting creates an immutable source-linked double-entry journal: DR depreciation expense, CR accumulated depreciation. The period-lock trigger rejects posting into closed periods, and asset-row locking plus unique month keys prevents concurrent double posting.
- A business-acquired asset's *purchase journal* is **not** automatically created; it must be recorded separately as an approved GL journal or posted vendor bill. This prevents booking fictitious cash movements.
- Only active company admins and finance managers (or verified platform owner) can invoke the posting function; tenant RLS prevents company crossover.
- No disposal, sale, impairment, revaluation, tax depreciation, partial-month convention or multi-currency is claimed. These require further workflows and policy approval.
- Never apply migration 044 to production until database branch testing and operations review.
