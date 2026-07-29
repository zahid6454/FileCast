import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// account.js exports nothing (it is an IIFE, like every other file in static/js),
// so these drive it the way the browser does — real source, canned network — and
// assert on what it renders. That still pins the pure logic the reviewer flagged:
// formatKb's sub-KB branch, maxUpload's modal scan, toolBadgeChildren's
// same-format fallback, and the pager's page-count arithmetic.

const API = 'https://api.test';
const MOUNT = '<div id="account-app"></div>';

const MB = 1024 * 1024;

// Four tools at 20MB and one at 50MB → 20MB is the modal limit.
const TOOLS = [
  {
    id: 'png-to-jpg',
    name: 'PNG to JPG Converter',
    slug: '/convert/png-to-jpg',
    input_format: 'PNG',
    output_format: 'JPG',
    max_file_size_bytes: 20 * MB
  },
  {
    id: 'svg-to-png',
    name: 'SVG to PNG Converter',
    slug: '/convert/svg-to-png',
    input_format: 'SVG',
    output_format: 'PNG',
    max_file_size_bytes: 20 * MB
  },
  {
    id: 'csv-to-json',
    name: 'CSV to JSON Converter',
    slug: '/convert/csv-to-json',
    input_format: 'CSV',
    output_format: 'JSON',
    max_file_size_bytes: 20 * MB
  },
  {
    id: 'docx-to-pdf',
    name: 'DOCX to PDF Converter',
    slug: '/convert/docx-to-pdf',
    input_format: 'DOCX',
    output_format: 'PDF',
    max_file_size_bytes: 20 * MB
  },
  {
    id: 'pdf-compress',
    name: 'PDF Compressor',
    slug: '/convert/pdf-compress',
    input_format: 'PDF',
    output_format: 'PDF',
    max_file_size_bytes: 50 * MB
  }
];

function row(over) {
  return Object.assign(
    {
      id: 1,
      tool_id: 'png-to-jpg',
      input_format: 'PNG',
      output_format: 'JPG',
      file_size_kb: 87,
      duration_ms: 640,
      status: 'success',
      created_at: '2026-07-29T20:45:00.000Z'
    },
    over
  );
}

// Boots account.js against a canned /me, /tool-data.json and history page.
async function mount(dom, { user = {}, history = [], total = null, tools = TOOLS } = {}) {
  dom.window.FILECAST = { apiBase: API };
  dom.window.document.cookie = 'fc_logged_in=1';
  const me = Object.assign(
    {
      id: 'u1',
      email: 'a@b.co',
      name: 'Test User',
      role: 'user',
      max_file_size: null,
      created_at: '2026-07-28T00:00:00.000Z',
      favorites: [],
      preferences: {}
    },
    user
  );
  const body = { has_more: false, history };
  if (total !== null) body.total = total;

  dom.window.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.indexOf('/auth/me') !== -1) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: me }) });
    }
    if (u.indexOf('tool-data.json') !== -1) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(tools) });
    }
    if (u.indexOf('/user/history') !== -1) {
      const off = Number((u.match(/offset=(\d+)/) || [0, 0])[1]);
      const lim = Number((u.match(/limit=(\d+)/) || [0, 10])[1]);
      const page = history.slice(off, off + lim);
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            Object.assign({}, body, { history: page, has_more: off + lim < history.length })
          )
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  evalScript(dom, 'account.js');
  await flush();
  await flush();
  await flush();
  return dom.window.document;
}

const cells = (doc) =>
  [...doc.querySelectorAll('.account-table tbody tr:first-child td')].map((td) =>
    td.textContent.trim()
  );

const stat = (doc, label) =>
  [...doc.querySelectorAll('.account-stat')]
    .filter((t) => t.querySelector('.account-stat__label').textContent === label)
    .map((t) => t.querySelector('.account-stat__value').textContent)[0];

describe('account.js — file size rendering (the 0 KB regression)', () => {
  // The bug this whole change set started from: Math.round(700 / 1024) === 0 was
  // written to the DB, so history showed "0 KB" beside a success.
  it('renders an already-stored 0 as "< 1 KB", never "0 KB"', async () => {
    const doc = await mount(createDom(MOUNT), { history: [row({ file_size_kb: 0 })] });
    expect(cells(doc)[1]).toBe('< 1 KB');
  });

  it('renders 1 KB, sub-MB and MB sizes on the documented boundaries', async () => {
    const doc = await mount(createDom(MOUNT), {
      history: [
        row({ id: 1, file_size_kb: 1 }),
        row({ id: 2, file_size_kb: 1023 }),
        row({ id: 3, file_size_kb: 1024 }),
        row({ id: 4, file_size_kb: 2480 })
      ]
    });
    const sizes = [...doc.querySelectorAll('.account-table tbody tr')].map((tr) =>
      tr.querySelectorAll('td')[1].textContent.trim()
    );
    expect(sizes).toEqual(['1 KB', '1023 KB', '1.0 MB', '2.4 MB']);
  });

  it('renders a null size as an em dash rather than 0', async () => {
    const doc = await mount(createDom(MOUNT), { history: [row({ file_size_kb: null })] });
    expect(cells(doc)[1]).toBe('—');
  });
});

describe('account.js — conversion badge', () => {
  it('shows "IN → OUT" for a real conversion', async () => {
    const doc = await mount(createDom(MOUNT), { history: [row()] });
    // No whitespace in the text: the three spans are spaced by CSS `gap`.
    expect(cells(doc)[0]).toBe('PNG→JPG');
    expect(doc.querySelector('.account-table tbody a').getAttribute('href')).toBe(
      '/convert/png-to-jpg/'
    );
  });

  // pdf-compress, image-resize et al. have input === output; "PDF → PDF" is noise.
  it('falls back to the tool name when input and output formats match', async () => {
    const doc = await mount(createDom(MOUNT), {
      history: [row({ tool_id: 'pdf-compress', input_format: 'PDF', output_format: 'PDF' })]
    });
    expect(cells(doc)[0]).toBe('PDF Compressor');
  });

  // A row still identifies its conversion after the tool leaves the catalogue,
  // because the formats are stored on the row itself rather than looked up.
  it('keeps the format pair for a retired tool, but renders no link', async () => {
    const doc = await mount(createDom(MOUNT), {
      history: [row({ tool_id: 'retired-tool' })]
    });
    expect(cells(doc)[0]).toBe('PNG→JPG');
    expect(doc.querySelector('.account-table tbody a')).toBeNull();
    // The id is still reachable rather than silently dropped.
    expect(doc.querySelector('.fc-badge--gone').getAttribute('title')).toBe('retired-tool');
  });

  it('degrades to an em dash when a retired tool also has no formats', async () => {
    const doc = await mount(createDom(MOUNT), {
      history: [row({ tool_id: 'retired-tool', input_format: null, output_format: null })]
    });
    expect(cells(doc)[0]).toBe('—');
    expect(doc.querySelector('.fc-badge--gone').getAttribute('title')).toBe('retired-tool');
  });
});

describe('account.js — max upload stat', () => {
  it('reports the doubled MODAL tool limit, not the maximum', async () => {
    // 20MB is modal (4 of 5 tools); 50MB is the max. Overstating sends people
    // to a rejection, so the modal is the safe one to show.
    const doc = await mount(createDom(MOUNT));
    expect(stat(doc, 'Max upload')).toBe('40 MB');
  });

  it('an admin-set per-user override wins outright over the catalogue', async () => {
    const doc = await mount(createDom(MOUNT), { user: { max_file_size: '200MB' } });
    expect(stat(doc, 'Max upload')).toBe('200 MB');
  });

  it('degrades to an em dash when no tool carries a size', async () => {
    const doc = await mount(createDom(MOUNT), {
      tools: TOOLS.map((t) => Object.assign({}, t, { max_file_size_bytes: null }))
    });
    expect(stat(doc, 'Max upload')).toBe('—');
  });

  it('survives an empty tool catalogue', async () => {
    const doc = await mount(createDom(MOUNT), { tools: [] });
    expect(stat(doc, 'Max upload')).toBe('—');
  });
});

describe('account.js — pager arithmetic', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => row({ id: i + 1 }));

  it('derives the page count from `total` (23 rows at 10/page → 3 pages)', async () => {
    const doc = await mount(createDom(MOUNT), { history: many(23), total: 23 });
    expect(doc.querySelector('.account-pager__info').textContent).toBe('Page 1 of 3');
  });

  it('shows no pager at all when everything fits on one page', async () => {
    const doc = await mount(createDom(MOUNT), { history: many(4), total: 4 });
    expect(doc.querySelector('.account-pager')).toBeNull();
  });

  it('omits the page count when the API predates `total`', async () => {
    const doc = await mount(createDom(MOUNT), { history: many(23) });
    expect(doc.querySelector('.account-pager__info').textContent).toBe('Page 1');
  });
});

describe('account.js — status and timestamp', () => {
  it('labels success and failure for assistive tech, not just by colour', async () => {
    const doc = await mount(createDom(MOUNT), {
      history: [row({ id: 1 }), row({ id: 2, status: 'failed' })]
    });
    const pills = [...doc.querySelectorAll('.account-status')];
    expect(pills.map((p) => p.getAttribute('aria-label'))).toEqual(['Success', 'Failed']);
    expect(pills[0].getAttribute('role')).toBe('img');
  });

  it('renders both timestamp variants, the short one without a year', async () => {
    const doc = await mount(createDom(MOUNT), { history: [row()] });
    const full = doc.querySelector('.account-when__full').textContent;
    const short = doc.querySelector('.account-when__short').textContent;
    expect(full).toMatch(/2026/);
    expect(short).not.toMatch(/2026/);
    // The short form is a strict prefix — same clock time, date minus the year.
    expect(full.startsWith(short.replace(/,?\s*$/, ''))).toBe(true);
  });

  it('carries a machine-readable datetime for the row', async () => {
    const doc = await mount(createDom(MOUNT), { history: [row()] });
    expect(doc.querySelector('.account-table tbody time').getAttribute('datetime')).toBe(
      '2026-07-29T20:45:00.000Z'
    );
  });
});

describe('account.js — signed-out safety', () => {
  it('leaves the server-rendered prompt alone with no fc_logged_in cookie', async () => {
    const dom = createDom('<div id="account-app"><p class="signed-out">Sign in</p></div>');
    dom.window.FILECAST = { apiBase: API };
    const fetchFn = vi.fn();
    dom.window.fetch = fetchFn;
    evalScript(dom, 'account.js');
    await flush();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector('.signed-out')).not.toBeNull();
  });
});
