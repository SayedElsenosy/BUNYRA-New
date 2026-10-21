# Scoped Kanban · 21 October 2026
The previous board counted only its first 500 cards and moved a stage before writing its audit. The new pipeline has full scoped totals and independent 25-card pages per column. Representatives see their own opportunities; managers see their team; company and project permission checks remain server-side. Paused stages containing cards and unassigned cards remain visible. Read-only cards cannot be moved.

Desktop drag/drop and the keyboard/mobile Move stage button open the same native dialog with a required 3–500 character reason. A successful move locks the target stage and opportunity, verifies the expected version/owner/project, updates the stage and writes before/after plus reason in one SQL statement. A stale record refreshes the board and asks the user to select again. No booking, contract or collection is created by a stage move. No schema migration is required.

Each card shows its representative, source, lead status and whole elapsed days since the latest stage movement, including legacy audit payloads; without movement history it uses creation time. Stage labels do not rewrite business status or approve a financial operation. Columns scroll internally to keep the page compact. Customer names open the existing customer profile.

## Validation
24 isolated DEV pipeline checks, six existing sales checks, 23 navigation checks and six HTTP checks: 59 checks. TypeScript passed. DEV browser verified reasoned movement, drag/drop opening the selected destination, cancellation without a second movement, 25→50 pagination, modal keyboard loop, mobile layout with no horizontal overflow. All writes used synthetic DEV fixtures. Production business records were not used for write tests.

## Remaining roadmap
SLA and recurring follow-ups, approved comparison selection and customer attachments remain separate batches. This release does not claim production load testing or full ERP completion. Linux build, merge and live release evidence is retained in the delivery outputs.
