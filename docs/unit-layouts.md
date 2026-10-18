# Workbook fields and interactive plans

The source workbook is parsed locally using its cached cell values. Only visible rows are imported; hidden worksheet rows are excluded from the first sheet, and original row numbers remain attached to errors and rounding notices. For the supplied Price List, 153 data rows contain six hidden historical rows; all 147 visible units validate and have Available status. Both conflicting case-insensitive duplicate codes were hidden. The original workbook is never modified.

Unit Code accepts slash, ampersand, dot, hyphen and underscore. Reservation is normalized to reserved. All 15 source columns are retained: Unit Code, Project Name, phase, Building Name, Floor Number, Unit Type, Gross Area (sqm), Price per sqm, Out Area, Price per sqm ( Out area ), Delivery Status, Availability Status, Total Price, Column 3 and /80. Additional columns are preserved as source strings, including precision beyond cents. /80 is retained under its source name without assuming a payment-plan meaning. Total Price remains authoritative; rate columns are not multiplied to reconstruct it. Eight cached formula totals are rounded with exact integer arithmetic to cents, with explicit preview notices and original values retained.

Manual entry, import mapping, previews and unit detail cards use shared field definitions. Existing units keep their IDs through permitted edits, so changed areas appear in plan details while geometry links remain intact. Area/price changes retain before and after audit snapshots; reserved and sold records remain protected by existing workflow and database guards. Import adds units only and never silently overwrites an existing code.

## Floor plan

Each ready PDF opens an interactive viewer with current inventory, Available-only filtering, code/building search, pagination, zoom, unit details and status refresh. Exact matching unit-code text labels on a PDF page can appear automatically as small clickable circles; these identify text locations, never ownership boundaries. Raster-only pages and unmatched or split text require manual mapping. The editor chooses an inventory unit, clicks at least three corners on the PDF page, links the polygon and saves the layout. No artificial positions are invented for unmatched units; they remain accessible through the unit list.

Coordinates are normalized to each PDF page, so overlays follow zoom. Unit colors and details are fetched from live inventory rather than stored in geometry. A new plan-file version starts with no inherited geometry, avoiding misaligned old boundaries. Pending/reserved/sold shapes cannot subsequently be moved or removed by this editor.

Layout data has company/project/file/unit foreign keys, forced tenant RLS, project permissions, optimistic versions, and atomic audited updates. Drafts stay private to authorized setup editors. Publication uses the separate plans.publish permission, with Company Admin access by default. Readers must hold project and inventory read access, and can access only published plans. Unapproved price fields and raw price-related source values remain hidden from readers. All original PDFs remain private in existing storage; no public bucket or third-party conversion is added.

## Validation

21 isolated database/workbook tests cover the source workbook, visibility, exact monetary rounding, full field retention, access control, draft/publication guards, stale edits, geometry, protected units, live statuses, area changes preserving geometry, version isolation and audit evidence. The existing 20 inventory integration tests also pass. Local browser tests verify a PDF canvas, available-unit clicks, full detail cards, drawing a four-corner boundary, linking it and save feedback. Browser fixtures and credentials are not published.

This change does not implement split/merge workflows, approved price lists, booking, offers, CAD-to-PDF conversion, or automated architectural boundary extraction.
