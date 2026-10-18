# Excel imports and project plan files

## Units from Excel

The inventory panel generates a blank XLSX template and parses the first worksheet locally in the browser. Maximum XLSX size is 5 MiB and maximum batch size is 1000 rows. Users map workbook columns to unit fields. Codes should be text cells to preserve leading zeros. Numeric cells are read as their original XML decimal strings, avoiding intermediate floating-point conversion. Arabic/Persian digits, Arabic decimal separators and correctly grouped thousands separators are normalized; ambiguous or invalid values are rejected.

Preview and commit both validate every row on the server under inventory.write and the Company Admin/Operations role restriction. Missing prices are errors, never an assumed zero. Only administrative available/unavailable statuses can be imported. Imported units receive draft proposed prices, not approved sales prices. Existing unit codes are never overwritten. The entire batch, initial status histories and audit snapshots commit atomically. A deterministic normalized payload hash makes retries idempotent. Uniqueness constraints roll back the whole batch if another user inserts a colliding code after preview. Errors show original Excel row numbers. The original workbook stays local; only mapped unit data and its filename are sent to the app.

## Floor-plan files

PDF, DWG and DXF originals are stored in the private project-plans bucket on the matching Neon branch. Bytes are never stored in Postgres. Metadata has composite company/project foreign keys, server-side access checks and tenant RLS. Each upload uses a new object key and monotonically increasing per-building/floor/type version. Previous originals remain available. File headers, size and SHA256 are checked; downloads verify the actual bytes again. Upload failure is recorded as rejected, never ready. Incomplete uploads remain visible to administrators for diagnosis. No deletion/purge endpoint exists.

Maximum file size is 10 MiB. A conservative 100 MiB per-company plan quota bounds storage use. Credentials stay server-side in Cloudflare secrets. The S3 client uses FetchHttpHandler, path-style addressing and required checksums for Workers compatibility. No external conversion website receives files.

PDF preview uses a locally hosted PDF.js worker, canvas-only page rendering, zoom and pagination. A PDF can be previewed locally before uploading. DWG/DXF originals are accepted for storage and download; direct CAD rendering/conversion is not implemented. Upload a PDF for the same building/floor to preview the drawing. No automatic unit extraction or polygon linking is claimed.

All files are setup drafts: ready means transfer complete, not published for Sales. Original files are visible/downloadable only to authorized setup editors. Floor-plan approval, sales publication and interactive unit polygons remain separate later workflows.

## Verification

Migration 006 is additive. Test with npm run test:files on explicitly isolated database and storage branches only. Test fixtures include fake units and small PDF/CAD headers and must never be committed into production companies. The production browser may preview fixtures locally or call preview, but must not commit them.
