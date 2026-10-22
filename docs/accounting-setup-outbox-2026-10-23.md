# Accounting setup and reliable finance posting

## Company setup

Migration 050 adds opt-in initialization of the default legal entity: 11 chart
accounts and five journals. Migrations 056–058 supersede the public initialization
with customer-advance controls and supplier payable mapping, without a default
receipt destination. The user explicitly selects a named account for each receipt.
This creates no opening
balances, sales recognition, VAT/tax settings or financial transactions.

Initialization serializes by company/entity and is idempotent. Conflicting codes
or mappings roll back the complete setup and preserve existing custom records.
It requires finance approval through both the authenticated API and database.

## Bank accounts and currencies

Treasury supports multiple named bank/cash accounts per company, including several
accounts in the same currency. Each owns a separate asset GL account and journal.
The initial supported currencies all have two decimal places: EGP, USD, EUR, GBP,
SAR, AED, QAR, CHF, CAD, AUD and CNY. Currency and GL links cannot be edited through
tenant CRUD. Account creation requires finance approval and is atomic and audited.

Booking receipt confirmation and later collections require explicit account choice
after setup. The account must match the contractual currency. Foreign receipts also
require a positive manual EGP conversion rate (up to eight decimals), captured with
the original source. Native amounts and historical EGP values use exact database
numeric arithmetic; general ledger reports remain in EGP. Contract allocation of an
existing booking receipt carries its destination without generating cash twice.

Refunds/reversals return to the original bank at the original historical receipt
rate. Cumulative valuation allocates rounding so split refunds clear the original
base and native amounts. Different-currency settlement, exchange-rate differences
on actual refunds, revaluation and interbank transfers are not provided by this
slice. The UI explicitly permits matching-currency receipt destinations only.
Supplier invoices/payments and manual voucher UI remain EGP; foreign bank lines
without native currency snapshots are rejected rather than misvalued.

Treasury shows separate native balances and matches bank statements against native
amounts. No guessed opening balances, automatic FX rates or real bank accounts are
created during rollout.

## Posting and recovery

Migrations 051–055 add:

- Immediate posting when a confirmed business event is captured, only for
  companies that explicitly enable automation with an authorized reviewer.
- A durable queue and immutable per-event attempt history. Posting failure is
  isolated in a database subtransaction; it leaves no partial journal and the
  source business event remains available for recovery.
- Bounded batches (default 10, maximum 50), row locks with SKIP LOCKED, original
  source idempotency and exponential retry delays capped at 60 minutes. Automatic
  attempts stop at eight; explicit requeue retains prior history and is audited.
- Company-local event posting and period-close checks use the same configured
  time zone. Cairo midnight/month boundaries are covered by integration tests.
- Live company status, subscription, role, custom-role and finance-approval
  overrides are checked. Project-level approval denial prevents that event from
  posting. Revoking authority stops both immediate and scheduled processing.
- Configured authority is recorded with automatic provenance. The business
  caller's company/user context is restored after automated processing.

The scheduled worker recovers due events every 30 minutes. It is not an HTTP
endpoint, and the global database processor is not executable by the tenant role.
Immediate posting handles normal latency; the less frequent cron avoids keeping
an otherwise idle database continuously awake. See [Neon scale-to-zero](https://neon.com/docs/introduction/scale-to-zero)
and [OpenNext custom worker](https://opennext.js.org/cloudflare/howtos/custom-worker).

Receipts remain cash/bank versus customer advances; the process does not invent
earned revenue. Source booking-receipt reallocation at contract signing remains
informational and cannot produce a second cash entry.

## Controls and verification

The ledger screen exposes initialization, automation enable/disable, due-batch
processing, waiting/retrying/review counts, safe failure descriptions, explicit
requeue and recent attempt history. A company with attempt history cannot be
purged; archive/restore remains available.

Protected Neon integration includes a rollback-only runner and a separate real
two-processor concurrency fixture. The latter is committed to make concurrency
real, suspended afterward, and retains its immutable synthetic journal on the
guarded development branch. Never run either fixture runner on production.

Activation requires a production-data rehearsal and the protected integration
workflow, followed by schema migration, source deployment and deliberate setup/
automation configuration for the selected company. Other companies stay disabled.
