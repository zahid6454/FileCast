// Dashboard tab (#dashboard, default) — Phase 4 §8.1, filter bar + analytics
// per ADMIN-DASHBOARD-ANALYTICS-PLAN.md §7.
//
// Two independent fetch shapes:
//  - Stat cards, Top tools, New signups, Ratings, Recent errors — unfiltered
//    (Top tools/New signups use a fixed DEFAULT_DAYS window, no selector: a
//    global filter bar was tried first, but Range only ever applied to all
//    4 cards while Tool only applied to 2 of them, which read as broken
//    rather than intentional once real data was on screen). All loaded once
//    via Promise.allSettled.
//  - Conversions and Errors each own an inline Range(+Tool) selector and
//    independently fetch/re-render only themselves on change
//    (scopedFilterCard()), following errors.js's existing scoped-re-render
//    pattern — a per-instance sequence counter discards a response
//    superseded by a newer change on that same card, the same race
//    errors.js's REQUEST_SEQ guards (§9.3). The two cards' selectors are
//    fully independent of each other (picking 90 days on Conversions has no
//    effect on Errors) and of Top tools/New signups.
//
// Charts are inline SVG built via dom.svg() — no library, every label a text
// node (R10). The recent-errors feed is the P23 hot spot: error_message comes
// from the public POST /errors, so it is rendered with textContent only
// (never markup). The new Errors-summary card never renders error_type raw
// (only two hardcoded Validation/Conversion labels) and never renders
// error_message at all, but its by-tool rows DO run attacker-influenceable
// tool_id values through labelFor() — safe via h()'s textContent-only rule,
// but not free of attacker-influenceable data the way an earlier draft of
// this comment claimed. Both splits are also capped server-side
// (stats.py's errors_summary()) so a caller sending many distinct
// error_type/tool_id values can't inflate either array unboundedly.
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;
  var svg = dom.svg;

  var RANGES = [
    { value: '7', label: '7 days', days: 7, groupBy: 'day' },
    { value: '30', label: '30 days', days: 30, groupBy: 'day' },
    { value: '90', label: '90 days', days: 90, groupBy: 'day' },
    { value: '365', label: '12 months', days: 365, groupBy: 'month' }
  ];
  // Fixed window for the widgets that don't get their own selector (Top
  // tools, New signups) — see the header comment for why they went
  // unfiltered instead of keeping a shared control.
  var DEFAULT_DAYS = 30;

  // Guards the outer (stat cards/Top tools/New signups/Ratings/Recent
  // errors) batch — render() can be re-entered (tab away and back) before a
  // prior call's fetch has resolved, and without this a slow first render()
  // landing after a faster second one would blank the up-to-date dashboard.
  var RENDER_SEQ = 0;

  function rangeConfigFor(value) {
    for (var i = 0; i < RANGES.length; i++) {
      if (RANGES[i].value === value) return RANGES[i];
    }
    return RANGES[1];
  }

  function labelFor(toolId) {
    if (ADMIN.catalog && typeof ADMIN.catalog.label === 'function') {
      return ADMIN.catalog.label(toolId);
    }
    return toolId;
  }

  // --- small building blocks ---------------------------------------------

  function statCard(label, value, sub, accent) {
    return h('div', { class: 'admin-stat' + (accent ? ' admin-stat--' + accent : '') }, [
      h('div', { class: 'admin-stat__value' }, value),
      h('div', { class: 'admin-stat__label' }, label),
      sub ? h('div', { class: 'admin-stat__sub' }, sub) : null
    ]);
  }

  function sectionCard(title, bodyNode, actionNode) {
    var header = actionNode
      ? h('div', { class: 'admin-card__head' }, [
          h('h2', { class: 'admin-card__title' }, title),
          actionNode
        ])
      : h('h2', { class: 'admin-card__title' }, title);
    return h('section', { class: 'admin-card' }, [header, bodyNode]);
  }

  function placeholder(message) {
    return h('div', { class: 'admin-empty' }, message);
  }

  function errorCard(title, onRetry) {
    var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
    retry.addEventListener('click', onRetry);
    return sectionCard(
      title,
      h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load this section."), retry])
    );
  }

  function pct(n, d) {
    if (!d) return '—';
    return Math.round((n / d) * 100) + '%';
  }

  // --- charts (inline SVG) ------------------------------------------------

  // Generic over-time line chart. `series` = [{date,count,failures?}].
  // `unit`/`ariaLabel` let New signups (§7.2) reuse this instead of a second
  // chart implementation — defaults keep the Conversions chart's exact
  // existing wording.
  function lineChart(series, unit, ariaLabel) {
    unit = unit || 'conversion';
    ariaLabel = ariaLabel || 'Conversions over time';
    var W = 640,
      H = 220,
      padL = 44,
      padR = 16,
      padT = 16,
      padB = 30;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    var values = series.map(function (p) {
      return p.count;
    });
    var maxVal = Math.max.apply(null, values.concat([0]));

    var frame = svg(
      'svg',
      {
        class: 'admin-chart',
        viewBox: '0 0 ' + W + ' ' + H,
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': ariaLabel
      },
      [
        // baseline + left axis
        svg('line', {
          class: 'admin-chart__axis',
          x1: padL,
          y1: padT,
          x2: padL,
          y2: padT + innerH
        }),
        svg('line', {
          class: 'admin-chart__axis',
          x1: padL,
          y1: padT + innerH,
          x2: padL + innerW,
          y2: padT + innerH
        })
      ]
    );

    if (series.length === 0 || maxVal === 0) {
      frame.appendChild(
        svg(
          'text',
          {
            class: 'admin-chart__placeholder',
            x: W / 2,
            y: H / 2,
            'text-anchor': 'middle'
          },
          'No data yet'
        )
      );
      return h('div', { class: 'admin-chart-wrap' }, [frame]);
    }

    var n = series.length;
    function xAt(i) {
      return n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW;
    }
    function yAt(v) {
      return padT + innerH - (v / maxVal) * innerH;
    }

    var points = series
      .map(function (p, i) {
        return xAt(i).toFixed(1) + ',' + yAt(p.count).toFixed(1);
      })
      .join(' ');

    // y-max label
    frame.appendChild(
      svg(
        'text',
        { class: 'admin-chart__tick', x: padL - 6, y: padT + 4, 'text-anchor': 'end' },
        String(maxVal)
      )
    );
    // first & last date labels
    frame.appendChild(
      svg(
        'text',
        { class: 'admin-chart__tick', x: padL, y: H - 8, 'text-anchor': 'start' },
        series[0].date
      )
    );
    if (n > 1) {
      frame.appendChild(
        svg(
          'text',
          { class: 'admin-chart__tick', x: padL + innerW, y: H - 8, 'text-anchor': 'end' },
          series[n - 1].date
        )
      );
    }
    // Soft area fill under the line (line points, then down to the baseline at
    // both ends) — adds colour without a gradient def or a charting library.
    var baseY = (padT + innerH).toFixed(1);
    var areaPoints =
      xAt(0).toFixed(1) + ',' + baseY + ' ' + points + ' ' + xAt(n - 1).toFixed(1) + ',' + baseY;
    frame.appendChild(svg('polygon', { class: 'admin-chart__area', points: areaPoints }));
    frame.appendChild(svg('polyline', { class: 'admin-chart__line', points: points }));
    // point dots — a larger invisible hit-area circle carries the hover/focus
    // target (the visible 2.5px dot is too small on its own). A JS-driven
    // tooltip div (below) shows the exact date/count/failures for that day —
    // an SVG <title> was tried first but its native browser tooltip has a
    // multi-second hover delay that reads as "nothing happens" (reported).
    // No per-tool breakdown: this series is a same-day sum across every tool,
    // so that's all there is to show without a different, heavier query.
    var wrap = h('div', { class: 'admin-chart-wrap' });
    var tip = h('div', { class: 'admin-chart__tooltip', role: 'status' });

    function showTip(clientX, clientY, label) {
      dom.clear(tip);
      tip.appendChild(document.createTextNode(label));
      var rect = wrap.getBoundingClientRect();
      tip.style.left = clientX - rect.left + 'px';
      tip.style.top = clientY - rect.top + 'px';
      tip.classList.add('is-visible');
    }
    function hideTip() {
      tip.classList.remove('is-visible');
    }

    series.forEach(function (p, i) {
      var cx = xAt(i).toFixed(1);
      var cy = yAt(p.count).toFixed(1);
      var label =
        p.date +
        ': ' +
        p.count +
        ' ' +
        (p.count === 1 ? unit : unit + 's') +
        (p.failures ? ', ' + p.failures + (p.failures === 1 ? ' failure' : ' failures') : '');
      var hit = svg('circle', {
        class: 'admin-chart__hit',
        cx: cx,
        cy: cy,
        r: 10,
        tabindex: 0,
        role: 'img',
        'aria-label': label
      });
      hit.addEventListener('pointerenter', function (e) {
        showTip(e.clientX, e.clientY, label);
      });
      hit.addEventListener('pointermove', function (e) {
        showTip(e.clientX, e.clientY, label);
      });
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('focus', function () {
        var r = hit.getBoundingClientRect();
        showTip(r.left + r.width / 2, r.top, label);
      });
      hit.addEventListener('blur', hideTip);
      frame.appendChild(
        svg('g', { class: 'admin-chart__point' }, [
          hit,
          svg('circle', { class: 'admin-chart__dot', cx: cx, cy: cy, r: 3.15 })
        ])
      );
    });
    wrap.appendChild(frame);
    wrap.appendChild(tip);
    return wrap;
  }

  // Top-tools horizontal bar chart. `tools` = [{tool_id,count}].
  function barChart(tools) {
    if (!tools || tools.length === 0) {
      return placeholder('No data yet');
    }
    var rowH = 26,
      gap = 8,
      labelW = 150,
      barMax = 320,
      W = labelW + barMax + 110;
    var H = tools.length * (rowH + gap) + gap;
    var maxCount = Math.max.apply(
      null,
      tools.map(function (t) {
        return t.count;
      })
    );
    var frame = svg('svg', {
      class: 'admin-chart admin-chart--bars',
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMinYMin meet',
      role: 'img',
      'aria-label': 'Top tools by conversions'
    });
    tools.forEach(function (t, i) {
      var y = gap + i * (rowH + gap);
      var w = maxCount ? (t.count / maxCount) * barMax : 0;
      frame.appendChild(
        svg(
          'text',
          {
            class: 'admin-chart__barlabel',
            x: labelW - 6,
            y: y + rowH / 2 + 4,
            'text-anchor': 'end'
          },
          labelFor(t.tool_id)
        )
      );
      frame.appendChild(
        svg('rect', {
          class: 'admin-chart__bar',
          x: labelW,
          y: y,
          width: Math.max(w, 1).toFixed(1),
          height: rowH,
          rx: 3
        })
      );
      var valueText =
        typeof t.visitors === 'number' ? t.count + ' (' + t.visitors + 'v)' : String(t.count);
      frame.appendChild(
        svg(
          'text',
          { class: 'admin-chart__barvalue', x: labelW + w + 6, y: y + rowH / 2 + 4 },
          valueText
        )
      );
    });
    return frame;
  }

  // Errors type/by-tool breakdown (§7.3). error_type is never rendered raw —
  // only the two hardcoded Validation/Conversion labels below — but by-tool
  // rows go through labelFor(), same as the recent-errors feed: an attacker
  // can POST /api/v1/errors with a tool_id that isn't in the catalog, and its
  // raw string reaches the DOM as that row's label. Still P23-safe (h() is
  // textContent-only, so no markup injection either way), just not a widget
  // free of attacker-influenceable data the way the header comment used to
  // (incorrectly) claim.
  function errorsSummaryWidget(data, days) {
    var byType = (data && data.by_type) || [];
    var byTool = (data && data.by_tool) || [];
    var body = [];
    if (byType.length === 0 && byTool.length === 0) {
      body.push(placeholder('No errors in this range 🎉'));
    } else {
      var counts = {};
      byType.forEach(function (t) {
        counts[t.error_type] = t.count;
      });
      body.push(
        h('div', { class: 'admin-errsummary__types' }, [
          h('div', { class: 'admin-errsummary__type' }, [
            h('span', { class: 'admin-errsummary__type-label' }, 'Validation'),
            h(
              'span',
              { class: 'admin-errsummary__type-value' },
              String(counts.validation_error || 0)
            )
          ]),
          h('div', { class: 'admin-errsummary__type' }, [
            h('span', { class: 'admin-errsummary__type-label' }, 'Conversion'),
            h(
              'span',
              { class: 'admin-errsummary__type-value' },
              String(counts.conversion_error || 0)
            )
          ])
        ])
      );
      if (byTool.length > 0) {
        body.push(
          h(
            'ul',
            { class: 'admin-errsummary__tools' },
            byTool.map(function (t) {
              return h('li', [
                h('span', labelFor(t.tool_id)),
                h('span', { class: 'admin-errsummary__tool-count' }, String(t.count))
              ]);
            })
          )
        );
      }
    }
    // Error rows are purged after retention_days (§2.4) — a wider selected
    // range would otherwise look silently sparse next to a full-width
    // Conversions trend for the same nominal window with no explanation.
    if (data && data.retention_days && days > data.retention_days) {
      body.push(
        h(
          'p',
          { class: 'admin-card__note' },
          'Errors are retained for ' + data.retention_days + ' days — showing all available data.'
        )
      );
    }
    return h('div', { class: 'admin-errsummary' }, body);
  }

  // --- self-contained scoped card (Conversions, Errors) --------------------

  // A card with its own inline Range(+Tool) selector that independently
  // fetches and re-renders only itself on change — mirrors errors.js's
  // loadErrors()/REQUEST_SEQ pattern (§9.3), scoped to one card instead of a
  // whole tab: a per-instance sequence counter discards a response
  // superseded by a newer change on THIS card.
  //
  // The selector row is built once and never torn down on reload — only
  // the title text and body are swapped — so a change never steals focus
  // mid-interaction (the same reasoning as errors.js's SHELL_BUILT guard
  // keeping its search input in place across a page fetch).
  //
  // opts: {
  //   includeTool: bool,
  //   title(cfg) -> string,
  //   buildUrl(cfg, toolId) -> string,
  //   renderBody(data, cfg) -> Node
  // }
  function scopedFilterCard(opts) {
    var range = '30';
    var tool = '';
    var seq = 0;

    var titleEl = h('h2', { class: 'admin-card__title' });
    var bodyHost = h('div');

    function setBody(node) {
      dom.clear(bodyHost);
      bodyHost.appendChild(node);
    }

    function load() {
      var mySeq = ++seq;
      var cfg = rangeConfigFor(range);
      titleEl.textContent = opts.title(cfg);
      setBody(h('div', { class: 'admin-loading' }, 'Loading…'));
      api.get(opts.buildUrl(cfg, tool)).then(
        function (data) {
          if (mySeq !== seq) return; // superseded by a newer change on this card
          setBody(opts.renderBody(data, cfg));
        },
        function (err) {
          if (mySeq !== seq) return;
          if (err && err.isAuthError) {
            ADMIN.onAuthError(err);
            return;
          }
          var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
          retry.addEventListener('click', load);
          setBody(
            h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load this section."), retry])
          );
        }
      );
    }

    var rangeSelect = h(
      'select',
      { class: 'tool-options__input', 'aria-label': 'Date range' },
      RANGES.map(function (r) {
        return h('option', { value: r.value }, r.label);
      })
    );
    rangeSelect.value = range;
    rangeSelect.addEventListener('change', function () {
      range = rangeSelect.value;
      load();
    });
    var filterChildren = [
      h('div', { class: 'tool-options__row tool-options__row--select' }, [
        h('label', { class: 'tool-options__label' }, 'Range'),
        rangeSelect
      ])
    ];
    if (opts.includeTool) {
      var toolSelect = h('select', { class: 'tool-options__input', 'aria-label': 'Tool' }, [
        h('option', { value: '' }, 'All tools')
      ]);
      var tools = (ADMIN.catalog && ADMIN.catalog.list) || [];
      tools.forEach(function (t) {
        toolSelect.appendChild(h('option', { value: t.id }, labelFor(t.id)));
      });
      toolSelect.value = tool;
      toolSelect.addEventListener('change', function () {
        tool = toolSelect.value;
        load();
      });
      filterChildren.push(
        h('div', { class: 'tool-options__row tool-options__row--select' }, [
          h('label', { class: 'tool-options__label' }, 'Tool'),
          toolSelect
        ])
      );
    }
    var filterRow = h('div', { class: 'admin-inline-filter' }, filterChildren);

    var card = h('section', { class: 'admin-card' }, [titleEl, filterRow, bodyHost]);
    load();
    return card;
  }

  // --- widgets ------------------------------------------------------------

  function statsWidget(data) {
    var attempts = data.total_conversions + data.total_failures;
    return h('div', { class: 'admin-stats' }, [
      statCard('Total conversions', String(data.total_conversions), null, 'primary'),
      statCard(
        'Failures',
        String(data.total_failures),
        pct(data.total_failures, attempts) + ' of attempts',
        'error'
      ),
      statCard(
        'Unique visitors',
        String(data.total_unique_visitors),
        'anonymous + signed-in, by day',
        'info'
      ),
      statCard('Users', String(data.total_users), null, 'success'),
      statCard(
        'Ratings',
        String(data.total_ratings),
        pct(data.yes_ratings, data.total_ratings) + ' helpful',
        'warning'
      )
    ]);
  }

  function errorsWidget(errors) {
    if (!errors || errors.length === 0) {
      return placeholder('No errors 🎉');
    }
    var list = h('ul', { class: 'admin-errfeed' });
    errors.forEach(function (e) {
      // EVERY field below is attacker-controlled (public POST /errors) and is
      // rendered via textContent by h() — the P23 firewall.
      list.appendChild(
        h('li', { class: 'admin-errfeed__item' }, [
          h('div', { class: 'admin-errfeed__head' }, [
            h('span', { class: 'admin-errfeed__tool' }, labelFor(e.tool_id)),
            e.error_type ? h('span', { class: 'admin-errfeed__type' }, e.error_type) : null,
            e.created_at
              ? h('time', { class: 'admin-errfeed__time' }, formatDate(e.created_at))
              : null
          ]),
          h('div', { class: 'admin-errfeed__msg' }, e.error_message || ''),
          e.browser ? h('div', { class: 'admin-errfeed__browser' }, e.browser) : null
        ])
      );
    });
    return list;
  }

  function ratingsWidget(ratings) {
    if (!ratings || ratings.length === 0) {
      return placeholder('No ratings yet');
    }
    // Sort by total votes desc for a stable, useful order; top 10 only, same
    // cap as Top Tools — there's no dedicated ratings page to page/link into.
    var sorted = ratings
      .slice()
      .sort(function (a, b) {
        return b.yes + b.no - (a.yes + a.no);
      })
      .slice(0, 10);
    var table = h('table', { class: 'admin-table admin-ratings' }, [
      h('thead', h('tr', [h('th', 'Tool'), h('th', 'Helpful'), h('th', 'Not'), h('th', '')]))
    ]);
    var tbody = h('tbody');
    sorted.forEach(function (r) {
      var total = r.yes + r.no;
      var ratio = total ? Math.round((r.yes / total) * 100) : 0;
      var fill = h('div', { class: 'admin-meter__fill' });
      fill.style.width = ratio + '%'; // JS-driven inline style attribute — CSP-allowed via style-src-attr 'unsafe-inline' (P2 §14), NOT the element-level style-src
      tbody.appendChild(
        h('tr', [
          h('td', labelFor(r.tool_id)),
          h('td', String(r.yes)),
          h('td', String(r.no)),
          h('td', [
            h('div', { class: 'admin-meter' }, [fill]),
            h('span', { class: 'admin-meter__label' }, ratio + '%')
          ])
        ])
      );
    });
    table.appendChild(tbody);
    return table;
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  // --- render -------------------------------------------------------------

  function render(container) {
    var seq = ++RENDER_SEQ;
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading dashboard…'));

    Promise.allSettled([
      api.get('/api/v1/stats/dashboard'),
      api.get('/api/v1/stats/errors?limit=10'),
      api.get('/api/v1/ratings'),
      api.get('/api/v1/stats/top-tools?days=' + DEFAULT_DAYS),
      api.get('/api/v1/stats/signups?days=' + DEFAULT_DAYS)
    ]).then(function (results) {
      if (seq !== RENDER_SEQ) return; // superseded by a newer render() (tab re-entry)
      // Bubble auth failures up to the global gate (R8).
      for (var i = 0; i < results.length; i++) {
        var reason = results[i].reason;
        if (reason && reason.isAuthError) {
          ADMIN.onAuthError(reason);
          return;
        }
      }
      dom.clear(container);
      var grid = h('div', { class: 'admin-dashboard' });

      // Stat cards — all-time, unaffected by anything below (§6.3).
      if (results[0].status === 'fulfilled') {
        grid.appendChild(statsWidget(results[0].value));
      } else {
        grid.appendChild(
          errorCard('Overview', function () {
            render(container);
          })
        );
      }

      // Conversions — owns its own inline Range+Tool selector.
      grid.appendChild(
        scopedFilterCard({
          includeTool: true,
          title: function (cfg) {
            return 'Conversions (' + cfg.label + ')';
          },
          buildUrl: function (cfg, toolId) {
            return (
              '/api/v1/stats/conversions?days=' +
              cfg.days +
              '&group_by=' +
              cfg.groupBy +
              (toolId ? '&tool_id=' + encodeURIComponent(toolId) : '')
            );
          },
          renderBody: function (data) {
            return lineChart((data && data.series) || []);
          }
        })
      );

      // Top tools — fixed window, no selector: a per-tool filter would be
      // self-defeating on a cross-tool ranking.
      if (results[3].status === 'fulfilled') {
        grid.appendChild(
          sectionCard(
            'Top tools (last ' + DEFAULT_DAYS + ' days)',
            barChart((results[3].value && results[3].value.top_tools) || [])
          )
        );
      } else {
        grid.appendChild(
          errorCard('Top tools', function () {
            render(container);
          })
        );
      }

      // New signups — fixed window, no selector: no tool dimension to
      // filter by in the first place.
      if (results[4].status === 'fulfilled') {
        grid.appendChild(
          sectionCard(
            'New signups (last ' + DEFAULT_DAYS + ' days)',
            lineChart(results[4].value || [], 'signup', 'New signups over time')
          )
        );
      } else {
        grid.appendChild(
          errorCard('New signups', function () {
            render(container);
          })
        );
      }

      // Ratings summary (one bulk call) — all-time, unchanged (§6.2/§9.5).
      if (results[2].status === 'fulfilled') {
        grid.appendChild(sectionCard('Ratings', ratingsWidget(results[2].value)));
      } else {
        grid.appendChild(
          errorCard('Ratings', function () {
            render(container);
          })
        );
      }

      // Errors — owns its own inline Range+Tool selector, grouped next to
      // the unfiltered Recent errors feed below (§3 item 6 distinguishes
      // them by purpose: analytical "what's breaking most" vs. operational
      // "what just broke", but both are error-related, so they sit together).
      grid.appendChild(
        scopedFilterCard({
          includeTool: true,
          title: function (cfg) {
            return 'Errors (' + cfg.label + ')';
          },
          buildUrl: function (cfg, toolId) {
            return (
              '/api/v1/stats/errors/summary?days=' +
              cfg.days +
              (toolId ? '&tool_id=' + encodeURIComponent(toolId) : '')
            );
          },
          renderBody: function (data, cfg) {
            return errorsSummaryWidget(data, cfg.days);
          }
        })
      );

      // Recent errors feed (P23 hot spot) — unfiltered "what just broke".
      if (results[1].status === 'fulfilled') {
        var errs = (results[1].value && results[1].value.errors) || [];
        var viewAllErrors =
          errs.length > 0
            ? h('a', { class: 'admin-card__action', href: '#errors' }, 'View all →')
            : null;
        grid.appendChild(sectionCard('Recent errors', errorsWidget(errs), viewAllErrors));
      } else {
        grid.appendChild(
          errorCard('Recent errors', function () {
            render(container);
          })
        );
      }

      container.appendChild(grid);
    });
  }

  ADMIN.tabs.dashboard = { render: render };
})();
