# Excel inventory updates
Choose Add and update existing units by code. Only visible Excel rows are used. Preview shows new, changed and unchanged counts plus before/after values. Commit requires the preview's unit IDs and versions. The database locks the project and existing rows and validates the whole batch before writing. Stale previews reject the whole batch. Retries use an idempotent receipt.

Existing unit IDs, plan shapes and unmapped optional columns are preserved. Pending/reserved/sold units are unchanged only; edits require the booking/sales workflow. Opening inventory may include these statuses for new units. Codes identify units and are not renamed by Excel sync. No rows missing from a workbook are deleted.

Migration 012 adds a SECURITY INVOKER function; tenant RLS stays active. Each created/updated unit and each batch is audited. Price values use integer currency cents, and source formula strings remain in details.
