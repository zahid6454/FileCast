// Database Nodes tab (#nodes) — NEON_FAILOVER_PLAN.md §7.12, Phase F.
//
// Admin-facing control surface for the multi-Neon-node failover pool built in
// Phases A-E: an overview table, a node detail slide-out, the switch confirm
// + live-progress flow, the add-node form + live-progress flow, a switch
// history list, and the five auto-saving failover-tuning settings (§8).
//
// Follows the exact pattern every other tab module uses — dom.h() DOM
// builder, never raw innerHTML (P23); every mutation goes through ADMIN.api
// and either a bespoke success toast (switch/provision/retire — the plan
// specifies their own copy) or ADMIN.notifySaved({ live: true }) for plain
// metadata/settings edits (rename, the Settings tab) — the same pattern
// announcements.js already uses for Redis-backed data that's live the
// instant it's written, skipping the static-rebuild Publish banner. This is
// a deliberate departure from site_settings.py/settings.js's batch-and-submit
// form, not an oversight (§7.12).
//
// Two real gaps surfaced building this against the actual Phase D/E code
// (both called out where they matter below, same posture as every prior
// phase's own bug trail in §11):
//   - No route ever exposed node_registry.py's get_switch_history() for the
//     History tab, despite that function's own docstring naming it as the
//     History tab's backing data since Phase A. Added GET /admin/nodes/history
//     in this PR (see admin_nodes.py) — the smallest fix that unblocks the
//     tab this phase actually has to ship.
//   - There is no per-node live health-check endpoint — only the ACTIVE
//     node's reachability is tracked at all (the shared reactive-trigger
//     counter, §7.4). The Health column and the detail slide-out's "Health
//     check" line are therefore derived from registry `status`, not a live
//     probe of every node (see healthCell()) — an honest simplification
//     given the actual API surface, not a new backend endpoint invented
//     for a frontend-only phase.
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});
  ADMIN.tabs = ADMIN.tabs || {};
  var dom = ADMIN.dom;
  var api = ADMIN.api;
  var h = dom.h;

  var CONTAINER = null;
  var VIEW = 'overview'; // 'overview' | 'history' | 'settings'
  var NODES = [];
  var SETTINGS = null;
  var HISTORY = [];
  var POOL = null; // { status: 'healthy' | 'degraded' } from GET /pool-health, or null if that fetch failed

  var TRIGGER_LABEL = { proactive: 'Proactive', reactive: 'Reactive', manual: 'Manual' };
  var STATUS_LABEL = {
    ready: 'Reserve',
    provisioning: 'Provisioning',
    error: 'Error',
    retired: 'Retired'
  };

  // --- small helpers --------------------------------------------------------

  function field(labelText, control) {
    return h('label', { class: 'admin-field' }, [
      h('span', { class: 'admin-field__label' }, labelText),
      control
    ]);
  }

  function dt(term, value) {
    return h('div', { class: 'admin-deflist__pair' }, [h('dt', term), h('dd', value)]);
  }

  function calloutBox(isWarning, body) {
    return h('div', { class: 'admin-callout' + (isWarning ? ' is-warning' : '') }, [
      ADMIN.icon(isWarning ? 'info' : 'check', 18, 'admin-callout__icon'),
      h('div', { class: 'admin-callout__body' }, body)
    ]);
  }

  function initials(name) {
    var s = (name || '?').trim();
    var parts = s.split(/[\s\-_]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (s.slice(0, 2) || '?').toUpperCase();
  }

  function fmtRelative(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var diffSec = Math.round((Date.now() - d.getTime()) / 1000);
    if (diffSec < 45) return 'just now';
    var diffMin = Math.round(diffSec / 60);
    if (diffMin < 45) return diffMin + (diffMin === 1 ? ' minute ago' : ' minutes ago');
    var diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
    var diffDay = Math.round(diffHr / 24);
    if (diffDay < 30) return diffDay + (diffDay === 1 ? ' day ago' : ' days ago');
    var diffMonth = Math.round(diffDay / 30);
    if (diffMonth < 12) return diffMonth + (diffMonth === 1 ? ' month ago' : ' months ago');
    var diffYear = Math.round(diffDay / 365);
    return diffYear + (diffYear === 1 ? ' year ago' : ' years ago');
  }

  function daysSince(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function usagePct(usage) {
    return usage && typeof usage.ratio === 'number' ? Math.round(usage.ratio * 100) : null;
  }

  // Reads the live warm-up/cutover thresholds from §8's settings, never a
  // hardcoded frontend breakpoint — otherwise this drifts the moment an
  // admin edits a setting (§7.12).
  function meterFillClass(pct) {
    if (pct === null || !SETTINGS) return '';
    if (pct >= SETTINGS.cutover_threshold_pct) return ' admin-meter__fill--error';
    if (pct >= SETTINGS.warmup_threshold_pct) return ' admin-meter__fill--warning';
    return '';
  }

  function usageMeter(usage) {
    var pct = usagePct(usage);
    if (pct === null) return h('span', { class: 'admin-muted' }, '—');
    var fill = h('span', { class: 'admin-meter__fill' + meterFillClass(pct) });
    fill.style.width = pct + '%'; // JS-driven inline style attribute — CSP-allowed (style-src-attr), same precedent as dashboard.js's ratingsWidget
    return h('span', {}, [
      h('span', { class: 'admin-meter' }, [fill]),
      h('span', { class: 'admin-meter__label' }, pct + '%')
    ]);
  }

  function nodeById(id) {
    for (var i = 0; i < NODES.length; i++) {
      if (NODES[i].node_id === id) return NODES[i];
    }
    return null;
  }

  function nodeLabel(id) {
    var n = nodeById(id);
    return n ? n.display_name : id;
  }

  function statusLabel(node) {
    if (node.is_active) return 'Active';
    return STATUS_LABEL[node.status] || node.status;
  }

  function statusBadgeClass(node) {
    if (node.is_active) return 'admin-badge--active';
    if (node.status === 'provisioning') return 'admin-badge--scheduled';
    if (node.status === 'error') return 'admin-badge--error';
    return 'admin-badge--inactive';
  }

  function statusBadge(node) {
    return h('span', { class: 'admin-badge ' + statusBadgeClass(node) }, statusLabel(node));
  }

  // See the module header — no live per-node health probe exists yet, only
  // the active node's own reachability is tracked. "Healthy"/"Unreachable"
  // is derived from registry status, which is the only signal actually
  // available for a reserve node.
  function healthCell(node) {
    if (node.status === 'provisioning') return h('span', { class: 'admin-muted' }, 'Checking…');
    var ok = node.status !== 'error';
    return h(
      'span',
      { class: 'node-health ' + (ok ? 'node-health--ok' : 'node-health--bad') },
      ok ? 'Healthy' : 'Unreachable'
    );
  }

  function lastActivityCell(node) {
    if (!node.last_activity) return h('span', { class: 'admin-muted' }, '—');
    var days = daysSince(node.last_activity);
    var warn = !!(SETTINGS && days !== null && days >= SETTINGS.inactivity_warning_days);
    return h(
      'span',
      { class: warn ? 'node-flag--warning' : '' },
      fmtRelative(node.last_activity) + (warn ? ' ⚠' : '')
    );
  }

  function rowActions(node) {
    if (node.is_active) return h('span', { class: 'admin-muted' }, 'Serving live traffic');
    if (node.status === 'ready') {
      var switchBtn = h(
        'button',
        { type: 'button', class: 'admin-btn admin-btn--secondary admin-btn--sm' },
        'Switch to this'
      );
      switchBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openSwitchConfirm(node);
      });
      return switchBtn;
    }
    if (node.status === 'error') {
      var retryBtn = h(
        'button',
        { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm' },
        'Retry'
      );
      retryBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        retryProvisioning(node);
      });
      return retryBtn;
    }
    return h('span', { class: 'admin-muted' }, 'Provisioning…');
  }

  function triggerBadge(trigger) {
    return h(
      'span',
      { class: 'trigger-badge trigger-badge--' + trigger },
      TRIGGER_LABEL[trigger] || trigger
    );
  }

  // --- drawer (slide-out) mechanics ------------------------------------------
  //
  // Same overlay/inert/Escape pattern tools.js's openSlideout/closeSlideout
  // uses, generalized so switch/provision progress can opt out of being
  // closeable while in flight (§7.12's switch progress has no close
  // affordance at all; add-node explicitly does — "Close (keeps running)").

  var drawerOverlay = null;
  var drawerPanel = null;
  var drawerOpener = null;
  var drawerKeydownHandler = null;
  var drawerCloseable = true;

  function openDrawer(opts) {
    closeDrawerImmediate();
    drawerOpener = document.activeElement;
    drawerCloseable = opts.closeable !== false;

    drawerOverlay = h('div', { class: 'admin-overlay' });
    if (drawerCloseable) {
      drawerOverlay.addEventListener('click', function () {
        closeDrawer();
      });
    }

    var headKids = [h('h2', { class: 'admin-slideout__title' }, opts.title)];
    if (drawerCloseable) {
      var closeBtn = h(
        'button',
        { type: 'button', class: 'admin-iconbtn', 'aria-label': 'Close' },
        '✕'
      );
      closeBtn.addEventListener('click', function () {
        closeDrawer();
      });
      headKids.push(closeBtn);
    }

    drawerPanel = h(
      'aside',
      { class: 'admin-slideout', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
      [
        h('div', { class: 'admin-slideout__head' }, headKids),
        h('div', { class: 'admin-slideout__body' }, opts.body || []),
        h('div', { class: 'admin-slideout__foot' }, opts.foot || [])
      ]
    );

    document.body.appendChild(drawerOverlay);
    document.body.appendChild(drawerPanel);

    var appRoot = document.getElementById('admin-app');
    if (appRoot) appRoot.inert = true;
    drawerKeydownHandler = function (e) {
      if (e.key === 'Escape' && drawerCloseable) {
        e.preventDefault();
        closeDrawer();
      }
    };
    document.addEventListener('keydown', drawerKeydownHandler);

    requestAnimationFrame(function () {
      drawerOverlay.classList.add('is-open');
      drawerPanel.classList.add('is-open');
    });

    return drawerPanel;
  }

  function closeDrawerImmediate() {
    if (drawerOverlay) drawerOverlay.remove();
    if (drawerPanel) drawerPanel.remove();
    if (drawerKeydownHandler) {
      document.removeEventListener('keydown', drawerKeydownHandler);
      drawerKeydownHandler = null;
    }
    var appRoot = document.getElementById('admin-app');
    if (appRoot) appRoot.inert = false;
    drawerOverlay = null;
    drawerPanel = null;
  }

  function closeDrawer() {
    if (!drawerCloseable) return;
    var opener = drawerOpener;
    closeDrawerImmediate();
    if (opener && document.contains(opener)) opener.focus();
    drawerOpener = null;
  }

  // --- live step progress (shared by switch + add-node) ----------------------

  function buildStepsList(labels) {
    var list = h('div', { class: 'admin-steps' });
    labels.forEach(function (label) {
      list.appendChild(
        h('div', { class: 'admin-step' }, [
          h('span', { class: 'admin-step__dot' }),
          h('span', { class: 'admin-step__label' }, label)
        ])
      );
    });
    return list;
  }

  function applyStepIndex(stepsEl, index, errored) {
    var steps = stepsEl.querySelectorAll('.admin-step');
    steps.forEach(function (el, i) {
      el.classList.remove('is-active', 'is-done', 'is-error');
      if (errored && i === Math.min(index, steps.length - 1)) {
        el.classList.add('is-error');
      } else if (i < index) {
        el.classList.add('is-done');
      } else if (i === index) {
        el.classList.add('is-active');
      }
    });
  }

  // --- switch flow -----------------------------------------------------------

  function openSwitchConfirm(target) {
    var active = NODES.filter(function (n) {
      return n.is_active;
    })[0];
    var warn = calloutBox(true, [
      'New conversions will briefly show a “try again in a moment” message while ',
      'anything in progress finishes and the final copy completes — usually a few ',
      'seconds. Reads and downloads are never affected.'
    ]);
    var deflist = h('dl', { class: 'admin-deflist' }, [
      dt('From', active ? active.display_name : '—'),
      dt('To', target.display_name)
    ]);
    var cancelBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Cancel');
    cancelBtn.addEventListener('click', function () {
      closeDrawer();
    });
    var confirmBtn = h(
      'button',
      { type: 'button', class: 'admin-btn admin-btn--primary' },
      'Confirm switch'
    );
    confirmBtn.addEventListener('click', function () {
      confirmBtn.disabled = true;
      submitSwitch(target);
    });
    openDrawer({
      title: 'Switch live traffic',
      body: [warn, deflist],
      foot: [cancelBtn, confirmBtn]
    });
  }

  function submitSwitch(target) {
    var active = NODES.filter(function (n) {
      return n.is_active;
    })[0];
    api
      .post('/api/v1/admin/nodes/' + encodeURIComponent(target.node_id) + '/switch')
      .then(function (res) {
        runSwitchProgress(res.run_id, active ? active.node_id : null, target.node_id);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        closeDrawer();
        ADMIN.toast((err && err.message) || 'Could not start the switch', 'error');
      });
  }

  var SWITCH_STEPS = [
    'Pausing new conversion pickup',
    'Final top-up sync',
    'Flipping live traffic',
    'Resuming normal service'
  ];
  var SWITCH_POLL_MS = 1500;
  var SWITCH_POLL_MAX_ERRORS = 5;

  // The backend's own progress text (data/node_ops.py) doesn't subdivide
  // 1:1 into these four labels — a manual switch's Phase 1 warm-up sync
  // reports as "Warming up target node …", which maps onto step 0 alongside
  // the initial "Switch queued" — but every transition below is still a
  // real signal from a real poll, never a fixed client-side timer.
  function switchStepIndex(detail, status) {
    if (status === 'done') return SWITCH_STEPS.length;
    if (!detail) return 0;
    if (detail.indexOf('Flipping') >= 0) return 2;
    if (detail.indexOf('top-up sync') >= 0) return 1;
    return 0;
  }

  function runSwitchProgress(runId, sourceId, targetId) {
    var stepsEl = buildStepsList(SWITCH_STEPS);
    var statusLine = h('p', { class: 'admin-slideout__meta' }, '');
    var footBtn = h(
      'button',
      { type: 'button', class: 'admin-btn admin-btn--ghost', disabled: true },
      'Switching in progress…'
    );
    openDrawer({
      title: 'Switching…',
      body: [stepsEl, statusLine],
      foot: [footBtn],
      closeable: false
    });
    applyStepIndex(stepsEl, 0, false);
    pollSwitch(runId, sourceId, targetId, stepsEl, statusLine, 0);
  }

  function pollSwitch(runId, sourceId, targetId, stepsEl, statusLine, errorCount) {
    api
      .get('/api/v1/admin/nodes/' + encodeURIComponent(runId) + '/status')
      .then(function (status) {
        if (document.body.contains(stepsEl)) {
          applyStepIndex(
            stepsEl,
            switchStepIndex(status.detail, status.status),
            status.status === 'error'
          );
          statusLine.textContent = status.detail || '';
        }
        if (status.status === 'pending') {
          setTimeout(function () {
            pollSwitch(runId, sourceId, targetId, stepsEl, statusLine, 0);
          }, SWITCH_POLL_MS);
          return;
        }
        drawerCloseable = true;
        if (document.body.contains(stepsEl)) closeDrawerImmediate();
        if (status.status === 'done') {
          ADMIN.toast(nodeLabel(targetId) + ' is now serving live traffic', 'success');
        } else {
          ADMIN.toast('Switch failed' + (status.detail ? ': ' + status.detail : ''), 'error');
        }
        reloadAll();
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        if (errorCount + 1 >= SWITCH_POLL_MAX_ERRORS) {
          drawerCloseable = true;
          if (document.body.contains(stepsEl)) closeDrawerImmediate();
          ADMIN.toast('Lost track of the switch’s progress — check the table shortly.', 'info');
          reloadAll();
          return;
        }
        setTimeout(function () {
          pollSwitch(runId, sourceId, targetId, stepsEl, statusLine, errorCount + 1);
        }, SWITCH_POLL_MS);
      });
  }

  // --- add-node flow -----------------------------------------------------

  function openAddNode() {
    var checklist = h('details', { class: 'admin-checklist' }, [
      h('summary', {}, 'Before you add it — checklist in Neon’s console'),
      h('ul', {}, [
        h('li', {}, ['Region: ', h('code', {}, 'AWS us-east-2'), ' (matches the existing fleet)']),
        h('li', {}, [
          'Postgres version: ',
          h('code', {}, '18'),
          ' — select explicitly, don’t accept the default'
        ]),
        h('li', {}, 'Leave compute size and autoscaling on the free-tier defaults'),
        h('li', {}, [
          'Copy the ',
          h('strong', {}, 'pooled'),
          ' connection string, not the direct one'
        ]),
        h('li', {}, 'Copy the project ID too — both go in the form below')
      ])
    ]);

    var nameInput = h('input', {
      type: 'text',
      class: 'admin-input',
      placeholder: 'filecast-5'
    });
    var connInput = h('textarea', {
      class: 'admin-input admin-input--mono',
      rows: '3',
      placeholder: 'postgresql://user:pass@ep-xxxx-pooler.us-east-2.aws.neon.tech/filecast'
    });
    var connField = h('label', { class: 'admin-field' }, [
      h('span', { class: 'admin-field__label' }, 'Connection string'),
      connInput,
      h(
        'span',
        { class: 'admin-field__hint' },
        'Paste it exactly as Neon shows it — the driver prefix is handled automatically.'
      )
    ]);
    var projectInput = h('input', {
      type: 'text',
      class: 'admin-input admin-input--mono',
      placeholder: 'plain-cell-51190872'
    });

    var cancelBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Cancel');
    cancelBtn.addEventListener('click', function () {
      closeDrawer();
    });
    var submitBtn = h(
      'button',
      { type: 'button', class: 'admin-btn admin-btn--primary' },
      'Add node'
    );
    submitBtn.addEventListener('click', function () {
      var name = nameInput.value.trim();
      var conn = connInput.value.trim();
      var project = projectInput.value.trim();
      if (!name || !conn || !project) {
        ADMIN.toast('Fill in every field', 'error');
        return;
      }
      submitBtn.disabled = true;
      api
        .post('/api/v1/admin/nodes', {
          display_name: name,
          connection_string: conn,
          neon_project_id: project
        })
        .then(function (res) {
          runProvisionProgress(res.run_id, name);
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          if (err && err.isAuthError) return ADMIN.onAuthError(err);
          ADMIN.toast((err && err.message) || 'Could not add this node', 'error');
        });
    });

    openDrawer({
      title: 'Add node',
      body: [
        checklist,
        field('Display name', nameInput),
        connField,
        field('Neon project ID', projectInput)
      ],
      foot: [cancelBtn, submitBtn]
    });
  }

  var PROVISION_STEPS = [
    'Checking connection',
    'Bringing schema up to date',
    'Copying current data',
    'Confirming usage tracking works'
  ];
  var PROVISION_POLL_MS = 1500;
  var PROVISION_POLL_MAX_ERRORS = 5;

  // The backend reports three distinct phases, not four — "Bringing schema
  // up to date and copying current data" is one combined message — so that
  // single real signal advances both of the middle two labels together
  // rather than inventing a fourth transition the backend never reports.
  function provisionStepIndex(detail, status) {
    if (status === 'done') return PROVISION_STEPS.length;
    if (!detail) return 0;
    if (detail.indexOf('Confirming usage') >= 0) return 3;
    if (detail.indexOf('schema') >= 0) return 2;
    return 0;
  }

  function runProvisionProgress(runId, displayName) {
    var stepsEl = buildStepsList(PROVISION_STEPS);
    var statusLine = h('p', { class: 'admin-slideout__meta' }, '');
    var closeBtn = h(
      'button',
      { type: 'button', class: 'admin-btn admin-btn--ghost' },
      'Close (keeps running)'
    );
    closeBtn.addEventListener('click', function () {
      closeDrawer();
    });

    openDrawer({
      title: 'Provisioning ' + displayName,
      body: [
        h('p', { class: 'admin-slideout__meta' }, 'This runs in the background — safe to close.'),
        stepsEl,
        statusLine
      ],
      foot: [closeBtn]
    });
    applyStepIndex(stepsEl, 0, false);

    // Refresh the table right away so the new "provisioning" row is visible
    // even if this poll's first response takes a moment.
    reloadAll();
    pollProvision(runId, displayName, stepsEl, statusLine, 0);
  }

  function pollProvision(runId, displayName, stepsEl, statusLine, errorCount) {
    api
      .get('/api/v1/admin/nodes/' + encodeURIComponent(runId) + '/status')
      .then(function (status) {
        if (document.body.contains(stepsEl)) {
          applyStepIndex(
            stepsEl,
            provisionStepIndex(status.detail, status.status),
            status.status === 'error'
          );
          statusLine.textContent = status.detail || '';
        }
        if (status.status === 'pending') {
          setTimeout(function () {
            pollProvision(runId, displayName, stepsEl, statusLine, 0);
          }, PROVISION_POLL_MS);
          return;
        }
        if (document.body.contains(stepsEl)) closeDrawerImmediate();
        if (status.status === 'done') {
          ADMIN.toast(displayName + ' is ready and in reserve', 'success');
        } else {
          ADMIN.toast(
            'Could not add ' + displayName + (status.detail ? ': ' + status.detail : ''),
            'error'
          );
        }
        reloadAll();
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        if (errorCount + 1 >= PROVISION_POLL_MAX_ERRORS) {
          if (document.body.contains(stepsEl)) closeDrawerImmediate();
          ADMIN.toast(
            'Lost track of ' + displayName + '’s progress — check the table shortly.',
            'info'
          );
          reloadAll();
          return;
        }
        setTimeout(function () {
          pollProvision(runId, displayName, stepsEl, statusLine, errorCount + 1);
        }, PROVISION_POLL_MS);
      });
  }

  function retryProvisioning(node) {
    api
      .post('/api/v1/admin/nodes/' + encodeURIComponent(node.node_id) + '/retry')
      .then(function (res) {
        runProvisionProgress(res.run_id, node.display_name);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast((err && err.message) || 'Could not retry provisioning', 'error');
      });
  }

  // --- node detail slide-out --------------------------------------------

  function detailCallout(node) {
    if (node.is_active) {
      return calloutBox(false, [
        h('strong', {}, 'Currently active. '),
        'Serving all live traffic. FileCast is watching its usage and will warm up a ' +
          'reserve node automatically as it approaches ' +
          (SETTINGS ? SETTINGS.warmup_threshold_pct : '—') +
          '%.'
      ]);
    }
    if (node.status === 'provisioning') {
      return calloutBox(
        false,
        'Still provisioning — checking connectivity, bringing the schema up to date, and ' +
          'copying a full initial data set from the active node. This can take a little while.'
      );
    }
    if (node.status === 'error') {
      return calloutBox(
        true,
        'This node failed during provisioning or a later retry. The specific reason was ' +
          'shown when it happened; use Retry from the table row to try again.'
      );
    }
    return calloutBox(
      false,
      'This node is in reserve. It receives a background sync at least once a week to ' +
        'keep it under Neon’s 90-day inactivity limit, and gets warmed up first if the ' +
        'active node starts running low.'
    );
  }

  function openNodeDetail(node) {
    var pct = usagePct(node.usage);
    var deflist = h('dl', { class: 'admin-deflist' }, [
      dt('Status', statusLabel(node)),
      dt('Usage this month', pct === null ? '—' : pct + '%'),
      dt('Health check', healthCell(node)),
      dt('Last activity', node.last_activity ? fmtRelative(node.last_activity) : '—')
    ]);

    var nameInput = h('input', { type: 'text', class: 'admin-input', value: node.display_name });
    var saveNameBtn = h(
      'button',
      { type: 'button', class: 'admin-btn admin-btn--ghost admin-btn--sm', disabled: true },
      'Save name'
    );
    nameInput.addEventListener('input', function () {
      var v = nameInput.value.trim();
      saveNameBtn.disabled = !v || v === node.display_name;
    });
    saveNameBtn.addEventListener('click', function () {
      renameNode(node, nameInput.value.trim(), saveNameBtn);
    });
    var nameField = h('div', { class: 'admin-field' }, [
      h('span', { class: 'admin-field__label' }, 'Display name'),
      h('div', { class: 'admin-settingrow' }, [nameInput, saveNameBtn])
    ]);

    // Neither action is coherent against the node presently serving traffic
    // (§7.8/§7.12) — both disabled, not just Switch.
    var switchDisabled = node.is_active || node.status !== 'ready';
    var switchLabel = node.is_active
      ? 'Already serving traffic'
      : node.status === 'ready'
        ? 'Switch to this node'
        : 'Not ready to switch to';
    var switchBtn = h(
      'button',
      {
        type: 'button',
        class: 'admin-btn admin-btn--primary',
        disabled: switchDisabled ? true : null
      },
      switchLabel
    );
    if (!switchDisabled) {
      switchBtn.addEventListener('click', function () {
        closeDrawer();
        setTimeout(function () {
          openSwitchConfirm(node);
        }, 180);
      });
    }

    var retireBtn = h(
      'button',
      {
        type: 'button',
        class: 'admin-btn admin-btn--danger',
        disabled: node.is_active ? true : null
      },
      'Retire node'
    );
    if (!node.is_active) {
      var retireArmed = false;
      var retireArmTimer = null;
      var disarmRetire = function () {
        if (retireArmTimer) {
          clearTimeout(retireArmTimer);
          retireArmTimer = null;
        }
        retireArmed = false;
        retireBtn.classList.remove('is-armed');
        retireBtn.textContent = 'Retire node';
      };
      retireBtn.addEventListener('click', function () {
        if (retireArmed) {
          disarmRetire();
          retireNode(node);
          return;
        }
        retireArmed = true;
        retireBtn.classList.add('is-armed');
        retireBtn.textContent = 'Confirm retire';
        retireArmTimer = setTimeout(disarmRetire, 4000);
      });
    }

    openDrawer({
      title: node.display_name,
      body: [
        h('p', { class: 'node-id' }, node.neon_project_id),
        deflist,
        detailCallout(node),
        nameField
      ],
      foot: [switchBtn, retireBtn]
    });
  }

  function renameNode(node, newName, btn) {
    if (!newName || newName === node.display_name) return;
    btn.disabled = true;
    api
      .request('PATCH', '/api/v1/admin/nodes/' + encodeURIComponent(node.node_id), {
        display_name: newName
      })
      .then(function () {
        closeDrawer();
        ADMIN.notifySaved({ live: true });
        reloadAll();
      })
      .catch(function (err) {
        btn.disabled = false;
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast((err && err.message) || 'Rename failed', 'error');
      });
  }

  function retireNode(node) {
    api
      .post('/api/v1/admin/nodes/' + encodeURIComponent(node.node_id) + '/retire')
      .then(function () {
        closeDrawer();
        ADMIN.toast(node.display_name + ' retired', 'success');
        reloadAll();
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast((err && err.message) || 'Could not retire this node', 'error');
      });
  }

  // --- overview screen -----------------------------------------------------

  function statTile(value, label, sub, accent) {
    return h('div', { class: 'admin-stat' + (accent ? ' admin-stat--' + accent : '') }, [
      h('div', { class: 'admin-stat__value' }, value),
      h('div', { class: 'admin-stat__label' }, label),
      sub ? h('div', { class: 'admin-stat__sub' }, sub) : null
    ]);
  }

  function buildStats() {
    var poolNodes = NODES.filter(function (n) {
      return n.status !== 'retired';
    });
    var active = poolNodes.filter(function (n) {
      return n.is_active;
    })[0];
    var reserveCount = poolNodes.filter(function (n) {
      return !n.is_active;
    }).length;
    var activePct = active ? usagePct(active.usage) : null;

    var lastValue = '—';
    var lastSub = null;
    if (HISTORY && HISTORY.length > 0) {
      lastValue = fmtRelative(HISTORY[0].at) || '—';
      lastSub = TRIGGER_LABEL[HISTORY[0].trigger] || HISTORY[0].trigger;
    }

    return h('div', { class: 'admin-stats' }, [
      statTile(
        active ? active.display_name : 'None',
        'Active node',
        active
          ? activePct === null
            ? 'Usage unknown yet'
            : activePct + '% of monthly quota used'
          : 'No active node',
        'primary'
      ),
      statTile(
        String(poolNodes.length),
        'Nodes in pool',
        reserveCount + ' reserve, ' + (active ? 1 : 0) + ' active',
        null
      ),
      statTile(
        SETTINGS.warmup_threshold_pct + '% / ' + SETTINGS.cutover_threshold_pct + '%',
        'Warm-up / cutover',
        'Editable in Settings',
        'success'
      ),
      statTile(lastValue, 'Last switch', lastSub, 'warning')
    ]);
  }

  // Same "does any reserve have meaningfully more headroom" check §7.11/§9
  // already computes server-side (pool_has_headroom()) — this reads GET
  // /pool-health directly rather than re-deriving the logic client-side.
  function poolBanner(pool) {
    var degraded = pool.status === 'degraded';
    return h('div', { class: 'admin-callout' + (degraded ? ' is-warning' : '') }, [
      ADMIN.icon(degraded ? 'info' : 'check', 20, 'admin-callout__icon'),
      h('div', { class: 'admin-callout__body' }, [
        h('strong', {}, degraded ? 'Pool running low. ' : 'Pool healthy. '),
        degraded
          ? 'No reserve node has meaningfully more headroom than the active one — add a node soon.'
          : 'A reserve node has plenty of headroom if the active one needs to hand off.',
        ' Reflects ',
        h('code', {}, 'GET /pool-health'),
        '.'
      ])
    ]);
  }

  function buildRow(node) {
    var tr = h('tr', node.status !== 'error' ? { class: 'node-row' } : {});
    var avatarCls = 'admin-avatar' + (node.is_active ? ' admin-avatar--active' : '');
    tr.appendChild(
      h(
        'td',
        h('div', { class: 'admin-usercell' }, [
          h('span', { class: avatarCls }, initials(node.display_name)),
          h('div', { class: 'admin-usercell__meta' }, [
            h('span', { class: 'admin-usercell__name' }, node.display_name),
            h('span', { class: 'node-id' }, node.neon_project_id)
          ])
        ])
      )
    );
    tr.appendChild(h('td', statusBadge(node)));
    tr.appendChild(h('td', usageMeter(node.usage)));
    tr.appendChild(h('td', healthCell(node)));
    tr.appendChild(h('td', lastActivityCell(node)));
    tr.appendChild(h('td', rowActions(node)));
    if (node.status !== 'error') {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        openNodeDetail(node);
      });
    }
    return tr;
  }

  function renderOverview(host) {
    dom.clear(host);

    var toolbar = h('div', { class: 'admin-toolbar' });
    toolbar.appendChild(h('h1', {}, 'Database nodes'));
    var addBtn = h('button', { type: 'button', class: 'admin-btn admin-btn--primary' }, [
      ADMIN.icon('plus', 15, 'admin-btn__icon'),
      h('span', {}, 'Add node')
    ]);
    addBtn.style.marginLeft = 'auto'; // JS-driven inline style — CSP-allowed, same allowance as dashboard.js
    addBtn.addEventListener('click', openAddNode);
    toolbar.appendChild(addBtn);
    host.appendChild(toolbar);

    if (POOL) host.appendChild(poolBanner(POOL));
    host.appendChild(buildStats());

    var poolNodes = NODES.filter(function (n) {
      return n.status !== 'retired';
    });
    if (poolNodes.length === 0) {
      host.appendChild(
        ADMIN.emptyState({
          icon: 'inbox',
          title: 'No nodes registered',
          text: 'Add a Neon project to start building a failover pool.'
        })
      );
      return;
    }

    var tbody = h('tbody');
    poolNodes.forEach(function (node) {
      tbody.appendChild(buildRow(node));
    });
    var table = h('table', { class: 'admin-table' }, [
      h(
        'thead',
        h('tr', [
          h('th', 'Node'),
          h('th', 'Status'),
          h('th', 'Usage this month'),
          h('th', 'Health'),
          h('th', 'Last activity'),
          h('th', '')
        ])
      ),
      tbody
    ]);
    host.appendChild(h('div', { class: 'admin-tablecard' }, [table]));
  }

  // --- history screen --------------------------------------------------------

  function historyReasonText(entry) {
    if (entry.detail) return entry.detail;
    if (entry.outcome === 'success') {
      return 'Completed with a brief pause for in-flight conversions; reads and downloads were unaffected.';
    }
    return null;
  }

  function historyCard(entry) {
    var titleRow = h('div', { class: 'admin-annc__msg' }, [
      h('strong', {}, nodeLabel(entry.source_node_id)),
      ' → ',
      h('strong', {}, nodeLabel(entry.target_node_id))
    ]);
    var metaParts = [];
    if (entry.outcome === 'failure') metaParts.push('Failed');
    metaParts.push(fmtRelative(entry.at) || entry.at);
    var reason = historyReasonText(entry);
    if (reason) metaParts.push(reason);
    var metaLine = h('div', { class: 'admin-annc__window' }, metaParts.join(' · '));

    return h('li', { class: 'admin-annc' }, [
      triggerBadge(entry.trigger),
      h('div', { class: 'admin-annc__main' }, [titleRow, metaLine])
    ]);
  }

  function renderHistory(host) {
    dom.clear(host);
    if (!HISTORY || HISTORY.length === 0) {
      host.appendChild(
        ADMIN.emptyState({
          icon: 'inbox',
          title: 'No switches yet',
          text: 'Every handoff between nodes — proactive, reactive, or manual — will show up here.'
        })
      );
      return;
    }
    var list = h('ul', { class: 'admin-anncs' });
    HISTORY.forEach(function (entry) {
      list.appendChild(historyCard(entry));
    });
    host.appendChild(list);
  }

  // --- settings screen -------------------------------------------------------

  var SETTINGS_FIELDS = [
    {
      key: 'warmup_threshold_pct',
      title: 'Warm-up threshold',
      desc: 'Start copying data to a fresh node in the background once the active node’s usage passes this.',
      min: 30,
      max: 90,
      step: 1,
      unit: '%'
    },
    {
      key: 'cutover_threshold_pct',
      title: 'Cutover threshold',
      desc: 'Do the final top-up sync and switch live traffic once usage passes this.',
      min: 50,
      max: 98,
      step: 1,
      unit: '%'
    },
    {
      key: 'usage_poll_interval_minutes',
      title: 'Usage check interval',
      desc: 'How often every node’s usage is polled. Checking costs nothing — it’s a status call, not a database connection.',
      min: 5,
      max: 60,
      step: 5,
      unit: 'min'
    },
    {
      key: 'inactivity_warning_days',
      title: 'Inactivity warning',
      desc: 'Flag a node in the table if it hasn’t been touched in this many days. The weekly keep-alive sync should normally keep this under 7.',
      min: 7,
      max: 60,
      step: 1,
      unit: 'days'
    },
    {
      key: 'reactive_failure_count',
      title: 'Reactive failure count',
      desc: 'Consecutive failed health checks on the active node before FileCast fails over automatically.',
      min: 1,
      max: 5,
      step: 1,
      unit: 'in a row'
    }
  ];

  function persistSetting(key, value) {
    var body = {};
    body[key] = value;
    api
      .put('/api/v1/admin/nodes/settings', body)
      .then(function (updated) {
        SETTINGS = updated;
        ADMIN.notifySaved({ live: true });
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        ADMIN.toast((err && err.message) || 'Could not save this setting', 'error');
      });
  }

  function settingCard(f) {
    var value = SETTINGS[f.key];
    var range = h('input', {
      type: 'range',
      min: String(f.min),
      max: String(f.max),
      step: String(f.step)
    });
    range.value = String(value);
    var number = h('input', {
      type: 'number',
      class: 'admin-input',
      min: String(f.min),
      max: String(f.max),
      step: String(f.step)
    });
    number.value = String(value);
    var unit = h('span', { class: 'admin-unit' }, f.unit);

    function clamp(v) {
      var n = parseInt(v, 10);
      if (isNaN(n)) n = SETTINGS[f.key];
      if (n < f.min) n = f.min;
      if (n > f.max) n = f.max;
      return n;
    }
    function commit(n) {
      if (n === SETTINGS[f.key]) return;
      persistSetting(f.key, n);
    }

    // Live-sync the pair while dragging/typing (§7.12: "kept in sync with
    // each other"); only PUT once the value settles — the range's `change`
    // event fires on release, the number's on blur/arrow-key — same
    // interaction shape as account.js's quality slider, the closest
    // existing auto-save-on-settle precedent in this codebase.
    range.addEventListener('input', function () {
      number.value = range.value;
    });
    number.addEventListener('input', function () {
      var n = parseInt(number.value, 10);
      if (!isNaN(n) && n >= f.min && n <= f.max) range.value = String(n);
    });
    range.addEventListener('change', function () {
      commit(clamp(range.value));
    });
    number.addEventListener('change', function () {
      var n = clamp(number.value);
      number.value = String(n);
      range.value = String(n);
      commit(n);
    });

    return h('div', { class: 'admin-card' }, [
      h('h3', { class: 'admin-card__title' }, f.title),
      h('p', { class: 'admin-card__note admin-muted' }, f.desc),
      h('div', { class: 'admin-settingrow' }, [range, number, unit])
    ]);
  }

  function renderSettings(host) {
    dom.clear(host);
    var grid = h('div', { class: 'admin-settingsgrid' });
    SETTINGS_FIELDS.forEach(function (f) {
      grid.appendChild(settingCard(f));
    });
    host.appendChild(grid);
  }

  // --- sub-nav + shell -------------------------------------------------------

  var SUBVIEWS = [
    { id: 'overview', label: 'Overview' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' }
  ];

  function buildSubnav() {
    var nav = h('div', { class: 'admin-toolbar' });
    SUBVIEWS.forEach(function (v) {
      var btn = h(
        'button',
        {
          type: 'button',
          class:
            'admin-btn admin-btn--sm ' +
            (VIEW === v.id ? 'admin-btn--secondary' : 'admin-btn--ghost')
        },
        v.label
      );
      btn.addEventListener('click', function () {
        if (VIEW === v.id) return;
        VIEW = v.id;
        renderShell(CONTAINER);
      });
      nav.appendChild(btn);
    });
    return nav;
  }

  function renderShell(container) {
    dom.clear(container);
    container.appendChild(buildSubnav());
    var viewHost = h('div', {});
    container.appendChild(viewHost);
    if (VIEW === 'history') renderHistory(viewHost);
    else if (VIEW === 'settings') renderSettings(viewHost);
    else renderOverview(viewHost);
  }

  // --- data loading ------------------------------------------------------

  function loadAll() {
    return Promise.allSettled([
      api.get('/api/v1/admin/nodes'),
      api.get('/api/v1/admin/nodes/settings'),
      api.get('/api/v1/admin/nodes/history'),
      api.get('/api/v1/pool-health')
    ]).then(function (results) {
      for (var i = 0; i < results.length; i++) {
        if (results[i].reason && results[i].reason.isAuthError) {
          throw results[i].reason;
        }
      }
      if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') {
        throw results[0].reason || results[1].reason || new Error('Could not load database nodes');
      }
      NODES = (results[0].value && results[0].value.nodes) || [];
      SETTINGS = results[1].value;
      HISTORY =
        results[2].status === 'fulfilled'
          ? (results[2].value && results[2].value.history) || []
          : [];
      POOL = results[3].status === 'fulfilled' ? results[3].value : null;
    });
  }

  // Refetches and re-renders the CURRENT view in place — used after a
  // mutation completes, never resets which sub-view (Overview/History/
  // Settings) the admin is looking at (unlike render(), which always lands
  // on Overview for a fresh tab visit).
  function reloadAll() {
    loadAll()
      .then(function () {
        if (CONTAINER) renderShell(CONTAINER);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        // The action that triggered this already succeeded and toasted; a
        // background refresh failing isn't worth a hard error state — the
        // table just catches up on the next real visit or action.
      });
  }

  function render(container) {
    CONTAINER = container;
    VIEW = 'overview';
    dom.clear(container);
    container.appendChild(h('div', { class: 'admin-loading' }, 'Loading database nodes…'));

    loadAll()
      .then(function () {
        renderShell(container);
      })
      .catch(function (err) {
        if (err && err.isAuthError) return ADMIN.onAuthError(err);
        dom.clear(container);
        var retry = h('button', { type: 'button', class: 'admin-btn admin-btn--ghost' }, 'Retry');
        retry.addEventListener('click', function () {
          render(container);
        });
        container.appendChild(
          h('div', { class: 'admin-error-state' }, [h('p', "Couldn't load database nodes."), retry])
        );
      });
  }

  ADMIN.tabs.nodes = { render: render };
})();
