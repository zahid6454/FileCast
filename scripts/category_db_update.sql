-- Build Action Plan Phase 0 — production database follow-up.
-- Run this AFTER the Phase 0 PR (chore/developer-tools-category-migration,
-- merged as v1.1.0) is live, against the PRODUCTION database only.
--
-- This is the "Recommended: a targeted update" path from the plan's
-- "Database update" section — touches only the category column on these 20
-- rows, not a full seed.py re-run (which rebuilds all 34 tool rows and has
-- previously inserted test accounts into production when ENVIRONMENT wasn't
-- set correctly).
--
-- Before running: re-verify this is still exactly the same 20 tools by
-- diffing against `grep -l "^category: developer-tools$\|^category: document-conversion$" tools/*.yaml`
-- on the current master — don't trust this file's list if time has passed.

BEGIN;

-- 8 tools: data-conversion -> developer-tools
UPDATE tools
SET category = 'developer-tools'
WHERE id IN (
    'csv-to-json',
    'html-to-markdown',
    'json-to-csv',
    'json-to-xml',
    'json-to-yaml',
    'markdown-to-html',
    'xml-to-json',
    'yaml-to-json'
)
AND category = 'data-conversion';

-- 12 tools: document-tools -> document-conversion
UPDATE tools
SET category = 'document-conversion'
WHERE id IN (
    'docx-to-pdf',
    'html-to-pdf',
    'image-to-pdf',
    'pdf-compress',
    'pdf-merge',
    'pdf-rotate',
    'pdf-split',
    'pdf-to-docx',
    'pdf-to-jpg',
    'pdf-to-png',
    'pptx-to-pdf',
    'xlsx-to-pdf'
)
AND category = 'document-tools';

-- Sanity check before committing: expect 8 and 12 respectively, and 0 rows
-- left on the old category ids.
SELECT category, count(*) FROM tools
WHERE id IN (
    'csv-to-json','html-to-markdown','json-to-csv','json-to-xml',
    'json-to-yaml','markdown-to-html','xml-to-json','yaml-to-json',
    'docx-to-pdf','html-to-pdf','image-to-pdf','pdf-compress',
    'pdf-merge','pdf-rotate','pdf-split','pdf-to-docx','pdf-to-jpg',
    'pdf-to-png','pptx-to-pdf','xlsx-to-pdf'
)
GROUP BY category;

-- Expect exactly two rows above: developer-tools | 8  and  document-conversion | 12
-- If that's what you see, COMMIT. Otherwise ROLLBACK and investigate.
-- COMMIT;
