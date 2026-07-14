// Dashboard tab (#dashboard, default) — Phase 4 §8.1.
//
// Loads its widgets in parallel with Promise.allSettled so one slow/failed call
// degrades to its own error card instead of blanking the tab (R12). Charts are
// inline SVG built via dom.svg() — no library, every label a text node (R10).
// The recent-errors feed is the P23 hot spot: error_message comes from the
// public POST /errors, so it is rendered with textContent only (never markup).
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;
  var svg = dom.svg;

  function labelFor(toolId) {
    if (ADMIN.catalog && typeof ADMIN.catalog.label === 'function') {
      return ADMIN.catalog.label(toolId);
    }
    return toolId;
  }

  // --- small building blocks ---------------------------------------------

  function statCard(label, value, sub) {
    return h('div', { class: 'admin-stat' }, [
      h('div', { class: 'admin-stat__value' }, value),
      h('div', { class: 'admin-stat__label' }, label),
      sub ? h('div', { class: 'admin-stat__sub' }, sub) : null,
    ]);
  }

  function sectionCard(title, bodyNode) {
    return h('section', { class: 'admin-card' }, [
      h('h2', { class: 'admin-card__title' }, title),
      bodyNode,
    ]);
  }

  function placeholder(message) {
    return h('div', { class: 'admin-empty' }, message);
  }

  function errorCard(title, onRetry) {
    var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
    retry.addEventListener('click', onRetry);
    return sectionCard(
      title,
      h('div', { class: 'admin-error-state' }, [
        h('p', "Couldn't load this section."),
        retry,
      ])
    );
  }

  function pct(n, d) {
    if (!d) return '—';
    return Math.round((n / d) * 100) + '%';
  }

  // --- charts (inline SVG) ------------------------------------------------

  // Conversions-over-time line chart. `series` = [{date,count,failures}].
  function lineChart(series) {
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
        'aria-label': 'Conversions over time',
      },
      [
        // baseline + left axis
        svg('line', {
          class: 'admin-chart__axis',
          x1: padL,
          y1: padT,
          x2: padL,
          y2: padT + innerH,
        }),
        svg('line', {
          class: 'admin-chart__axis',
          x1: padL,
          y1: padT + innerH,
          x2: padL + innerW,
          y2: padT + innerH,
        }),
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
            'text-anchor': 'middle',
          },
          'No data yet'
        )
      );
      return frame;
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
    frame.appendChild(svg('polyline', { class: 'admin-chart__line', points: points }));
    // point dots
    series.forEach(function (p, i) {
      frame.appendChild(
        svg('circle', {
          class: 'admin-chart__dot',
          cx: xAt(i).toFixed(1),
          cy: yAt(p.count).toFixed(1),
          r: 2.5,
        })
      );
    });
    return frame;
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
      W = labelW + barMax + 60;
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
      'aria-label': 'Top tools by conversions',
    });
    tools.forEach(function (t, i) {
      var y = gap + i * (rowH + gap);
      var w = maxCount ? (t.count / maxCount) * barMax : 0;
      frame.appendChild(
        svg(
          'text',
          { class: 'admin-chart__barlabel', x: labelW - 6, y: y + rowH / 2 + 4, 'text-anchor': 'end' },
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
          rx: 3,
        })
      );
      frame.appendChild(
        svg(
          'text',
          { class: 'admin-chart__barvalue', x: labelW + w + 6, y: y + rowH / 2 + 4 },
          String(t.count)
        )
      );
    });
    return frame;
  }

  // --- widgets ------------------------------------------------------------

  function statsWidget(data) {
    var attempts = data.total_conversions + data.total_failures;
    return h('div', { class: 'admin-stats' }, [
      statCard('Total conversions', String(data.total_conversions)),
      statCard('Failures', String(data.total_failures), pct(data.total_failures, attempts) + ' of attempts'),
      statCard('Users', String(data.total_users)),
      statCard('Ratings', String(data.total_ratings), pct(data.yes_ratings, data.total_ratings) + ' helpful'),
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
              : null,
          ]),
          h('div', { class: 'admin-errfeed__msg' }, e.error_message || ''),
          e.browser ? h('div', { class: 'admin-errfeed__browser' }, e.browser) : null,
        ])
      );
    });
    return list;
  }

  function ratingsWidget(ratings) {
    if (!ratings || ratings.length === 0) {
      return placeholder('No ratings yet');
    }
    // Sort by total votes desc for a stable, useful order.
    var sorted = ratings.slice().sort(function (a, b) {
      return b.yes + b.no - (a.yes + a.no);
    });
    var table = h('table', { class: 'admin-table admin-ratings' }, [
      h('thead', h('tr', [h('th', 'Tool'), h('th', 'Helpful'), h('th', 'Not'), h('th', '')])),
    ]);
    var tbody = h('tbody');
    sorted.forEach(function (r) {
      var total = r.yes + r.no;
      var ratio = total ? Math.round((r.yes / total) * 100) : 0;
      var fill = h('div', { class: 'admin-meter__fill' });
      fill.style.width = ratio + '%'; // inline style is CSP-allowed (style-src 'unsafe-inline')
      tbody.appendChild(
        h('tr', [
          h('td', labelFor(r.tool_id)),
          h('td', String(r.yes)),
          h('td', String(r.no)),
          h('td', [
            h('div', { class: 'admin-meter' }, [fill]),
            h('span', { class: 'admin-meter__label' }, ratio + '%'),
          ]),
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
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading dashboard…'));

    Promise.allSettled([
      api.get('/api/v1/stats/dashboard'),
      api.get('/api/v1/stats/conversions?days=30'),
      api.get('/api/v1/stats/errors?limit=50'),
      api.get('/api/v1/ratings'),
    ]).then(function (results) {
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

      // Stat cards
      if (results[0].status === 'fulfilled') {
        grid.appendChild(statsWidget(results[0].value));
      } else {
        grid.appendChild(errorCard('Overview', function () {
          render(container);
        }));
      }

      // Conversions line chart
      if (results[1].status === 'fulfilled') {
        var series = (results[1].value && results[1].value.series) || [];
        grid.appendChild(sectionCard('Conversions (30 days)', lineChart(series)));
      } else {
        grid.appendChild(errorCard('Conversions (30 days)', function () {
          render(container);
        }));
      }

      // Top-tools bar chart (from the dashboard payload)
      if (results[0].status === 'fulfilled') {
        grid.appendChild(sectionCard('Top tools', barChart(results[0].value.top_tools || [])));
      }

      // Ratings summary (one bulk call)
      if (results[3].status === 'fulfilled') {
        grid.appendChild(sectionCard('Ratings', ratingsWidget(results[3].value)));
      } else {
        grid.appendChild(errorCard('Ratings', function () {
          render(container);
        }));
      }

      // Recent errors feed (P23 hot spot)
      if (results[2].status === 'fulfilled') {
        var errs = (results[2].value && results[2].value.errors) || [];
        grid.appendChild(sectionCard('Recent errors', errorsWidget(errs)));
      } else {
        grid.appendChild(errorCard('Recent errors', function () {
          render(container);
        }));
      }

      container.appendChild(grid);
    });
  }

  ADMIN.tabs.dashboard = { render: render };
})();
