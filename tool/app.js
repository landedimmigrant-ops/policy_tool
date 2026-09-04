/* Federal Policy Pathways: the tool.
   tool/app.js. Owner: Opus UX. Built to docs/design-spec.md.

   Defines window.PolicyTool and does NOT boot itself. The shell calls PolicyTool.boot().
   Holds: state, the router, the data loader, the shared renderers, and the plan.
   A mode file never fetches, never writes the hash or localStorage, and never
   hand-builds a card, chip, meter, banner or empty state. */

(function () {
  'use strict';

  /* ==========================================================
     1. Constants
     ========================================================== */

  var MODES = ['start', 'walk', 'openings', 'plan'];
  var VIEWS = ['process', 'influence', 'both'];

  /* Dev affordance, not a product feature: ?data=<base> loads the JSON files from
     somewhere other than ../data/. Used while the content files are written in
     parallel, and by whoever builds Modes B and C against stub data. */
  var DATA_BASE = (function () {
    try {
      var q = new URLSearchParams(location.search).get('data');
      if (q) return q.replace(/\/?$/, '/');
    } catch (e) {}
    return '../data/';
  })();

  /* Where "Tell us what is missing" goes. A GitHub issue for now, because it is
     real and works without a backend. Prem swaps in a Concordia form URL when
     one exists; feedbackHref() already handles a plain URL with query params. */
  var FEEDBACK_URL = 'https://github.com/landedimmigrant-ops/policy_tool/issues/new';

  var SCHEMA = 1;   /* bump when the shape of pt-plan changes */

  var CRDC_DIVISIONS = [
    'Natural sciences',
    'Engineering and technology',
    'Medical, health and life sciences',
    'Agricultural and veterinary sciences',
    'Social sciences',
    'Humanities and the arts'
  ];

  var DOMAINS = {
    'health': 'Health',
    'environment-climate': 'Environment and climate',
    'energy-natural-resources': 'Energy and natural resources',
    'agriculture-food': 'Agriculture and food',
    'fisheries-oceans': 'Fisheries and oceans',
    'science-research-innovation': 'Science, research and innovation',
    'digital-data-privacy': 'Digital, data and privacy',
    'economy-finance-trade': 'Economy, finance and trade',
    'labour-skills-social': 'Labour, skills and social policy',
    'education-youth': 'Education and youth',
    'immigration-multiculturalism': 'Immigration and multiculturalism',
    'justice-rights-security': 'Justice, rights and security',
    'indigenous': 'Indigenous',
    'culture-heritage-media': 'Culture, heritage and media',
    'official-languages': 'Official languages',
    'transport-infrastructure-housing': 'Transport, infrastructure and housing',
    'international-defence': 'International and defence',
    'governance-public-administration': 'Governance and public administration'
  };

  var SOURCE_KIND_LABEL = {
    consultation: 'Consultation', bill: 'Bill', gazette: 'Gazette', tender: 'Tender',
    committee: 'Committee', funding: 'Funding', appointment: 'Appointment', review: 'Review'
  };

  /* Machine-fetched from an official feed, so the check chip reads Verified. */
  var MACHINE_KINDS = ['consultation', 'bill', 'gazette', 'tender'];

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

  /* Spec 8.6. Artefact time estimates have no home in the data contract, so they
     live here and every one of them renders with a Check chip. */
  var ARTEFACT_TIME = [
    [/bilingual|translat/i, 'One business day per 2,000 words'],
    [/ten pages|the brief|500-word/i, 'Four days'],
    [/two-page|two- to four-page|evidence note|synthesis/i, 'Two days'],
    [/costed|cost estimate|a number|costed number/i, 'Two days'],
    [/one page|one-pager|plain language|plain-language/i, 'Half a day'],
    [/contact|organization name|organisation name|messenger/i, 'An hour']
  ];
  var ARTEFACT_TIME_DEFAULT = 'Half a day';

  var OWNER_MAP = [
    [/gazette\.gc\.ca/i, 'Canada Gazette'],
    [/canadabuys\.canada\.ca/i, 'CanadaBuys'],
    [/parl\.ca\/legisinfo|legisinfo/i, 'Parliament of Canada'],
    [/sencanada\.ca/i, 'Senate of Canada'],
    [/pbo-dpb\.ca/i, 'Parliamentary Budget Officer'],
    [/oag-bvg\.gc\.ca/i, 'Office of the Auditor General'],
    [/sshrc-crsh|nserc|cihr-irsc/i, 'Tri-agency']
  ];

  var DEPT_SLUGS = {
    'health-canada': 'Health Canada',
    'department-finance': 'Department of Finance',
    'environment-climate-change': 'Environment and Climate Change Canada',
    'natural-resources-canada': 'Natural Resources Canada',
    'innovation-science-economic-development': 'Innovation, Science and Economic Development Canada',
    'employment-social-development': 'Employment and Social Development Canada',
    'treasury-board-secretariat': 'Treasury Board of Canada Secretariat',
    'transport-canada': 'Transport Canada',
    'immigration-refugees-citizenship': 'Immigration, Refugees and Citizenship Canada',
    'canadian-heritage': 'Canadian Heritage'
  };

  /* ==========================================================
     2. Helpers
     ========================================================== */

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function frag() { return document.createDocumentFragment(); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function wrap(child) { var w = el('div', 'wrap'); if (child) w.appendChild(child); return w; }

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      if (!planSchemaTooNew) localStorage.setItem('pt-schema', String(SCHEMA));  /* never stamp over a newer build's */
    } catch (e) { storageBroken = true; }
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { storageBroken = true; return null; }
  }
  var storageBroken = false;

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
  }

  function reduceMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function scrollBehavior() { return reduceMotion() ? 'auto' : 'smooth'; }

  /* Dates are YYYY-MM-DD strings. Never new Date("2026-09-08"), which parses as UTC
     and drifts a day in Eastern time. */
  function parseDate(iso) {
    if (!iso) return null;
    var m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function today() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function daysUntil(iso) {
    var d = parseDate(iso);
    if (!d) return null;
    return Math.round((d - today()) / 86400000);
  }
  function dateLabel(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function isoOf(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function addDays(iso, n) {
    var d = parseDate(iso);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return isoOf(d);
  }
  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }

  /* ==========================================================
     3. Event bus
     ========================================================== */

  var handlers = {};
  var bus = {
    on: function (evt, fn) { (handlers[evt] || (handlers[evt] = [])).push(fn); },
    off: function (evt, fn) {
      var a = handlers[evt]; if (!a) return;
      var i = a.indexOf(fn); if (i > -1) a.splice(i, 1);
    },
    emit: function (evt, payload) {
      var a = handlers[evt]; if (!a) return;
      a.slice().forEach(function (fn) { try { fn(payload); } catch (e) { console.warn('PolicyTool: handler for ' + evt + ' threw', e); } });
    }
  };

  /* ==========================================================
     4. State
     ========================================================== */

  var state = {
    mode: 'start',
    policyStage: 1,
    view: 'process',
    discipline: null,
    filters: { stage: null, domain: null, closes: null, open: null, kinds: [], q: '' }
  };

  var data = {
    stages: null, situations: null, disciplines: null, crosswalk: null,
    tips: null, sitting: null, curated: null, feeds: null, live: null,
    stageById: null, disciplineById: null, committeeByAcronym: null,
    domainToDisciplines: null, openings: [], dropped: 0, failed: []
  };

  function snapshot() {
    return Object.freeze({
      mode: state.mode,
      policyStage: state.policyStage,
      view: state.view,
      discipline: state.discipline,
      filters: Object.freeze({
        stage: state.filters.stage, domain: state.filters.domain,
        closes: state.filters.closes, open: state.filters.open,
        kinds: state.filters.kinds.slice(), q: state.filters.q
      }),
      plan: planApi.get()
    });
  }

  /* ==========================================================
     5. Router
     ========================================================== */

  var isWriting = false;

  function parseQuery(s) {
    var out = {};
    String(s || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i === -1 ? pair : pair.slice(0, i);
      var v = i === -1 ? '' : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
      catch (e) { out[k] = v; }
    });
    return out;
  }
  function buildQuery(obj) {
    var parts = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === null || v === undefined || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function parseHash(raw) {
    var h = String(raw || '').replace(/^#/, '');
    if (!h) return null;
    /* v1 compatibility: a bare #s4-both arriving at /tool/ is upgraded once. */
    var v1 = h.match(/^s([1-6])(?:-(process|influence|both))?$/);
    if (v1) return { mode: 'walk', policyStage: +v1[1], view: v1[2] || 'process', query: {}, upgraded: true };
    if (h.charAt(0) !== '/') return null;
    var qi = h.indexOf('?');
    var path = qi === -1 ? h : h.slice(0, qi);
    var query = qi === -1 ? {} : parseQuery(h.slice(qi + 1));
    var parts = path.slice(1).split('/').filter(Boolean);
    var mode = parts[0] || 'start';
    if (MODES.indexOf(mode) === -1) return null;
    var out = { mode: mode, query: query };
    if (mode === 'walk' && parts[1]) {
      var m = parts[1].match(/^s([1-6])(?:-(process|influence|both))?$/);
      if (m) { out.policyStage = +m[1]; out.view = m[2] || 'process'; }
    }
    return out;
  }

  function buildHash() {
    var q = {};
    if (state.mode === 'walk') {
      if (state.discipline) q.d = state.discipline;
      return '#/walk/s' + state.policyStage + (state.view !== 'process' ? '-' + state.view : '') + buildQuery(q);
    }
    if (state.mode === 'openings') {
      var f = state.filters;
      if (state.discipline) q.d = state.discipline;
      if (f.stage) q.stage = f.stage;
      if (f.closes) q.closes = f.closes;
      if (f.open) q.open = f.open;
      if (f.kinds && f.kinds.length) q.kind = f.kinds.join(',');
      if (f.q) q.q = f.q;
      return '#/openings' + buildQuery(q);
    }
    if (state.mode === 'plan') {
      if (planShareHash) return planShareHash;
      return '#/plan';
    }
    return '#/start';
  }
  var planShareHash = null;

  function applyParsed(p) {
    if (!p) return;
    state.mode = p.mode;
    if (p.policyStage) state.policyStage = p.policyStage;
    if (p.view && VIEWS.indexOf(p.view) > -1) state.view = p.view;
    var q = p.query || {};
    if (q.d !== undefined) {
      state.discipline = (data.disciplineById && data.disciplineById.get(q.d)) ? q.d : null;
    }
    if (p.mode === 'openings') {
      state.filters.stage = /^[1-6]$/.test(q.stage || '') ? +q.stage : null;
      state.filters.closes = ['7', '30', '90', 'standing'].indexOf(q.closes) > -1 ? q.closes : null;
      state.filters.open = ['anyone', 'organisation', 'parliamentarian'].indexOf(q.open) > -1 ? q.open : null;
      state.filters.kinds = q.kind ? String(q.kind).split(',').filter(function (k) { return SOURCE_KIND_LABEL[k]; }) : [];
      state.filters.q = q.q || '';
      state.filters.domain = state.discipline;
    }
  }

  function writeHash(push) {
    var h = buildHash();
    if (('#' + location.hash.replace(/^#/, '')) === h) return;
    isWriting = true;
    try {
      if (push) history.pushState(null, '', h);
      else history.replaceState(null, '', h);
    } catch (e) { location.hash = h; }
    isWriting = false;
  }

  function persist() {
    store('pt-mode', state.mode);
    store('pt-stage', String(state.policyStage));
    store('pt-view', state.view);
    store('pt-discipline', state.discipline);
    if (state.mode === 'openings') {
      try { store('pt-filters', JSON.stringify(state.filters)); } catch (e) {}
    }
    if (state.mode !== 'start') store('pt-seen-doors', '1');
  }

  function onHistory() {
    if (isWriting) return;
    var p = parseHash(location.hash);
    if (!p) { p = { mode: 'start', query: {} }; }
    var wasMode = state.mode;
    applyParsed(p);
    persist();
    if (p.upgraded) writeHash(false);
    if (state.mode !== wasMode) activate(state.mode);
    else renderActive();
    renderShell();
  }

  /* ==========================================================
     6. Shared renderers. ui.* returns DOM elements, never strings.
     ========================================================== */

  function chip(text, kind) {
    if (kind === 'verified') { var v = el('span', 'v', 'Verified'); return v; }
    if (kind === 'check') { var c = el('span', 'v check', 'Check'); return c; }
    var n = el('span', 'chip' + (kind === 'accent' ? ' accent' : ''), text);
    return n;
  }

  function meter(n, opts) {
    opts = opts || {};
    var of = opts.of || 5;
    var s = el('span', 'meter' + (opts.big ? ' big' : '') + (opts.copper ? ' meter--copper' : ''));
    s.setAttribute('aria-hidden', 'true');
    for (var i = 1; i <= of; i++) s.appendChild(el('i', i <= n ? 'on' : null));
    return s;
  }

  function stageChip(policyStage, opts) {
    opts = opts || {};
    var b = el('button', 'pt-stagechip', 'Policy stage ' + policyStage);
    b.type = 'button';
    if (opts.link === false) { b.disabled = true; }
    else {
      b.addEventListener('click', function () {
        go('#/walk/s' + policyStage + '-influence' + (state.discipline ? '?d=' + encodeURIComponent(state.discipline) : ''));
      });
    }
    return b;
  }

  function button(label, opts) {
    opts = opts || {};
    var b = el('button', 'pt-btn' + (opts.variant ? ' pt-btn--' + opts.variant : ''), label);
    b.type = 'button';
    if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(!!opts.pressed));
    if (opts.disabled) b.disabled = true;
    if (opts.ariaLabel) b.setAttribute('aria-label', opts.ariaLabel);
    if (opts.onClick) b.addEventListener('click', opts.onClick);
    return b;
  }

  function empty(opts) {
    var box = el('div', 'pt-empty');
    box.appendChild(el('h3', null, opts.title));
    if (opts.body) box.appendChild(el('p', null, opts.body));
    if (opts.actionLabel) {
      box.appendChild(button(opts.actionLabel, { variant: 'copper', onClick: opts.onAction }));
    }
    return box;
  }

  function skeleton(count) {
    var box = el('div', 'pt-skeletons');
    for (var i = 0; i < (count || 3); i++) box.appendChild(el('div', 'pt-skeleton'));
    return box;
  }

  function banner(kind, text, opts) {
    opts = opts || {};
    var b = el('div', 'pt-banner pt-banner--' + kind);
    b.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    b.appendChild(el('p', null, text));
    if (opts.actionLabel) b.appendChild(button(opts.actionLabel, { onClick: opts.onAction }));
    return b;
  }

  function field(labelText, control) {
    var box = el('div', 'pt-field');
    var id = control.id || ('pt-f-' + Math.random().toString(36).slice(2, 8));
    control.id = id;
    var l = el('label', null, labelText);
    l.setAttribute('for', id);
    box.appendChild(l);
    box.appendChild(control);
    return box;
  }

  /* Spec 3.13 and 4.5. Rendered by Mode A under the routes list and by Mode B inside
     the freshness block, so it lives here and neither mode keeps its own copy. */
  function sittingLine() {
    var box = el('p', 'pt-sitting');
    var sitting = data.sitting;
    if (!sitting || !sitting.sitting_weeks || !sitting.sitting_weeks.length) {
      box.appendChild(document.createTextNode('House sitting weeks did not load. Check the calendar before you count on a committee route. '));
      box.appendChild(chip(null, 'check'));
      return box;
    }
    var weeks = sitting.sitting_weeks;
    var now = null, next = null, last = null;
    weeks.forEach(function (wk) {
      var a = daysUntil(wk.start), b = daysUntil(wk.end);
      if (a !== null && b !== null && a <= 0 && b >= 0) now = wk;
      if (a !== null && a > 0 && !next) next = wk;
      last = wk;
    });
    if (now) {
      box.className = 'pt-sitting is-sitting';
      box.textContent = 'The House is sitting this week. Committee and parliamentarian routes are live.';
    } else if (next) {
      box.className = 'pt-sitting is-recess';
      box.textContent = 'The House is not sitting this week. Committee and parliamentarian routes resume ' + dateLabel(next.start) + '.';
    } else {
      box.className = 'pt-sitting is-recess';
      box.appendChild(document.createTextNode('The House is not sitting this week. The calendar in the tool ends ' + dateLabel(last.end) + '. '));
      box.appendChild(chip(null, 'check'));
    }
    return box;
  }

  /* Spec 3.16 lists .pt-kindchip among the shared small components. */
  function kindChip(kind, pressed, onClick) {
    var b = el('button', 'pt-kindchip', SOURCE_KIND_LABEL[kind] || kind);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!pressed));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function closesLabel(record) {
    if (!record.closes || isStanding(record)) return 'Standing, no deadline';
    var d = daysUntil(record.closes);
    if (d === null) return 'Standing, no deadline';
    if (d < 0) return 'Closed ' + dateLabel(record.closes);
    if (d === 0) return 'Closes today';
    if (d === 1) return 'Closes in 1 day';
    return 'Closes in ' + d + ' days, ' + dateLabel(record.closes);
  }

  function isStanding(record) {
    if (!record.closes) return true;
    var d = daysUntil(record.closes);
    return d !== null && d > 365;
  }
  function isExpired(record) {
    if (!record.expires_on) return false;
    var d = daysUntil(record.expires_on);
    return d !== null && d < 0;
  }
  function isClosed(record) {
    if (!record.closes || isStanding(record)) return false;
    var d = daysUntil(record.closes);
    return d !== null && d < 0;
  }
  function isGone(record) {
    if (!record.expires_on) return false;
    var d = daysUntil(record.expires_on);
    return d !== null && d < -30;
  }

  function ownerFor(record) {
    var url = record && record.source_url ? String(record.source_url) : '';
    if (!url) return null;
    var cm = url.match(/ourcommons\.ca\/[Cc]ommittees\/[a-z]{2}\/([A-Z]{3,6})/);
    if (cm) {
      var found = data.committeeByAcronym && data.committeeByAcronym.get(cm[1]);
      return found ? found.name : cm[1];
    }
    var dm = url.match(/canada\.ca\/[a-z]{2}\/([a-z0-9-]+)/);
    if (dm && DEPT_SLUGS[dm[1]]) return DEPT_SLUGS[dm[1]];
    for (var i = 0; i < OWNER_MAP.length; i++) {
      if (OWNER_MAP[i][0].test(url)) return OWNER_MAP[i][1];
    }
    return null;
  }

  function tipFor(record) {
    if (record && record.tip) return record.tip;
    var t = data.tips && data.tips.tips;
    if (!t || !record) return null;
    var byKind = t[record.source_kind];
    if (!byKind) return null;
    return byKind[String(record.policyStage)] || byKind['default'] || null;
  }

  function artefactTime(text) {
    var s = String(text || '');
    for (var i = 0; i < ARTEFACT_TIME.length; i++) {
      if (ARTEFACT_TIME[i][0].test(s)) return { label: ARTEFACT_TIME[i][1], confidence: 'check' };
    }
    return { label: ARTEFACT_TIME_DEFAULT, confidence: 'check' };
  }

  function verifiedKind(record) {
    if (MACHINE_KINDS.indexOf(record.source_kind) > -1 && record._tier !== 3) return 'verified';
    var d = daysUntil(record.verified_on);
    if (d !== null && d > -90) return 'verified';
    return 'check';
  }

  /* The only place opening-card markup exists. */
  function openingCard(record, opts) {
    opts = opts || {};
    var inPlan = opts.inPlan !== undefined ? opts.inPlan : planApi.has(record.id);
    var expired = isExpired(record);
    var soon = !expired && !isStanding(record) && daysUntil(record.closes) !== null && daysUntil(record.closes) <= 7 && daysUntil(record.closes) >= 0;

    var card = el('article', 'pt-opening'
      + (inPlan ? ' is-inplan' : '')
      + (expired ? ' is-expired' : '')
      + (soon ? ' is-soon' : '')
      + (isStanding(record) ? ' is-standing' : ''));
    card.setAttribute('data-id', record.id);
    card.setAttribute('data-tier', String(record._tier || 3));

    var head = el('header', 'pt-opening__head');
    var h3 = el('h3', 'pt-opening__title');
    var a = el('a', null, record.title);
    a.href = record.source_url;
    a.target = '_blank';
    a.rel = 'noopener';
    h3.appendChild(a);
    head.appendChild(h3);
    var closes = el('p', 'pt-opening__closes');
    closes.textContent = expired
      ? 'Expired ' + dateLabel(record.expires_on) + '. Left here for reference until ' + dateLabel(addDays(record.expires_on, 30)) + '.'
      : closesLabel(record);
    head.appendChild(closes);
    card.appendChild(head);

    if (record.body) card.appendChild(el('p', 'pt-opening__body', record.body));

    var meta = el('ul', 'pt-opening__meta');
    var li1 = el('li'); li1.appendChild(stageChip(record.policyStage)); meta.appendChild(li1);
    var owner = ownerFor(record);
    if (owner) meta.appendChild(el('li', 'pt-opening__owner', owner));
    if (SOURCE_KIND_LABEL[record.source_kind]) {
      meta.appendChild(el('li', 'pt-opening__kind', SOURCE_KIND_LABEL[record.source_kind]));
    }
    var liv = el('li');
    liv.appendChild(chip(null, verifiedKind(record)));
    liv.appendChild(document.createTextNode(' ' + dateLabel(record.verified_on)));
    meta.appendChild(liv);
    card.appendChild(meta);

    if (opts.showTip !== false) {
      var tip = tipFor(record);
      var tipBox = el('div', 'pt-opening__tip' + (tip ? '' : ' pt-opening__tip--none'));
      tipBox.appendChild(el('h4', null, 'How to intervene'));
      if (tip) {
        tipBox.appendChild(el('p', null, tip));
      } else {
        var p = el('p', null, 'No tip written for this kind of opening yet. ');
        p.appendChild(chip(null, 'check'));
        tipBox.appendChild(p);
      }
      card.appendChild(tipBox);
    }

    var actions = el('div', 'pt-opening__actions');
    if (expired) {
      actions.appendChild(el('span', 'pt-opening__closed', 'Closed'));
    } else {
      var btn = button(inPlan ? 'In your plan' : 'Add to plan', {
        variant: 'copper',
        pressed: inPlan,
        onClick: function () {
          if (planApi.has(record.id)) planApi.remove(record.id);
          else planApi.add(record);
        }
      });
      actions.appendChild(btn);
    }
    card.appendChild(actions);
    return card;
  }

  var ui = {
    el: el, clear: clear, wrap: wrap, frag: frag,
    chip: chip, meter: meter, stageChip: stageChip, button: button,
    empty: empty, skeleton: skeleton, banner: banner, field: field,
    openingCard: openingCard, sittingLine: sittingLine, kindChip: kindChip,
    dateLabel: dateLabel, closesLabel: closesLabel
  };

  var format = {
    dateLabel: dateLabel, closesLabel: closesLabel, daysUntil: daysUntil,
    addDays: addDays, plural: plural, isStanding: isStanding,
    isExpired: isExpired, domainLabel: function (id) { return DOMAINS[id] || id; },
    kindLabel: function (id) { return SOURCE_KIND_LABEL[id] || id; }
  };

  /* ==========================================================
     7. Data
     ========================================================== */

  var FILES = [
    ['stages', 'stages.json', true],
    ['situations', 'situations.json', false],
    ['disciplines', 'disciplines.json', false],
    ['crosswalk', 'crosswalk.json', false],
    ['tips', 'tips.json', false],
    ['sitting', 'sitting.json', false],
    ['curated', 'curated.json', false],
    ['feeds', 'feeds.json', false]
  ];

  var FILE_LABEL = {
    situations: 'The situation cards', disciplines: 'Fields', crosswalk: 'Committees',
    tips: 'Tips', sitting: 'Sitting weeks', curated: 'Curated openings', feeds: 'The daily build'
  };

  function fetchJson(name) {
    return fetch(DATA_BASE + name, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
      return r.json();
    });
  }

  function loadAll() {
    return Promise.allSettled(FILES.map(function (f) { return fetchJson(f[1]); }))
      .then(function (results) {
        results.forEach(function (res, i) {
          var key = FILES[i][0];
          if (res.status === 'fulfilled') data[key] = res.value;
          else {
            data[key] = null;
            data.failed.push(key);
            console.warn('PolicyTool: ' + FILES[i][1] + ' did not load.', res.reason && res.reason.message);
          }
        });
        buildIndices();
      });
  }

  function buildIndices() {
    data.stageById = new Map();
    if (data.stages && data.stages.stages) {
      data.stages.stages.forEach(function (s) { data.stageById.set(s.id, s); });
    }
    data.disciplineById = new Map();
    data.domainToDisciplines = new Map();
    if (data.disciplines && data.disciplines.disciplines) {
      data.disciplines.disciplines.forEach(function (d) {
        data.disciplineById.set(d.id, d);
        (d.domains || []).forEach(function (dom) {
          if (!DOMAINS[dom]) return;
          if (!data.domainToDisciplines.has(dom)) data.domainToDisciplines.set(dom, []);
          data.domainToDisciplines.get(dom).push(d.id);
        });
      });
    }
    data.committeeByAcronym = new Map();
    if (data.crosswalk && data.crosswalk.committees) {
      data.crosswalk.committees.forEach(function (c) { data.committeeByAcronym.set(c.acronym, c); });
    }
    rebuildOpenings();
  }

  function validOpening(r) {
    return r && r.id && r.title && r.source_url && r.source_kind && r.verified_on
      && typeof r.policyStage === 'number' && r.policyStage >= 1 && r.policyStage <= 6;
  }
  function normUrl(u) {
    return String(u || '').toLowerCase().split('?')[0].replace(/\/+$/, '');
  }

  /* Merge: curated, then feeds, then live. First wins, because a curated record
     carries a hand-written tip and a human check date. */
  function rebuildOpenings() {
    var sources = [
      [3, data.curated && data.curated.records],
      [2, data.feeds && data.feeds.records],
      [1, data.live && data.live.records]
    ];
    var byId = new Map(), byUrl = new Map(), out = [], dropped = 0;
    sources.forEach(function (pair) {
      (pair[1] || []).forEach(function (r) {
        if (!validOpening(r)) { dropped++; return; }
        if (byId.has(r.id)) return;
        var nu = normUrl(r.source_url);
        if (nu && byUrl.has(nu)) return;
        var rec = Object.assign({}, r, { _tier: pair[0] });
        byId.set(r.id, rec);
        if (nu) byUrl.set(nu, rec);
        out.push(rec);
      });
    });
    out = out.filter(function (r) { return !isGone(r); });
    out.sort(function (a, b) {
      /* Open dated items first, then standing items, then expired ones. A board
         that says "what is open now" should not open on what just closed; the
         expired cards stay visible at the end, greyed, so the shut window is
         still on record. Director's decision of 4 September 2026, amending
         spec section 8.5. */
      var ae = isExpired(a), be = isExpired(b);
      if (ae !== be) return ae ? 1 : -1;
      var ac = isClosed(a), bc = isClosed(b);
      if (ac !== bc) return ac ? 1 : -1;
      var as = isStanding(a), bs = isStanding(b);
      if (as !== bs) return as ? 1 : -1;
      if (as && bs) return String(a.title).localeCompare(String(b.title));
      var ad = parseDate(a.closes), bd = parseDate(b.closes);
      if (!ad && !bd) return String(a.title).localeCompare(String(b.title));
      if (!ad) return 1;
      if (!bd) return -1;
      return ad - bd;
    });
    data.openings = out;
    data.dropped = dropped;
    return out;
  }

  /* Tier 1 is lazy: called by Mode B on first activation, never at boot. */
  var liveState = { status: 'idle', fetched_at: null, errors: [] };
  function loadLive(force) {
    if (liveState.status === 'loading') return liveState.promise;
    if (liveState.status === 'done' && !force) return Promise.resolve(data.live);
    if (!window.PolicyFeeds || typeof window.PolicyFeeds.loadLive !== 'function') {
      liveState.status = 'error';
      liveState.errors = ['feeds-live.js is not loaded'];
      bus.emit('data:live', liveState);
      return Promise.resolve(null);
    }
    liveState.status = 'loading';
    bus.emit('data:live', liveState);
    liveState.promise = window.PolicyFeeds.loadLive().then(function (res) {
      data.live = res || { records: [] };
      liveState.status = 'done';
      liveState.fetched_at = (res && res.fetched_at) || new Date().toISOString();
      liveState.errors = (res && res.errors) || [];
      rebuildOpenings();
      bus.emit('data:live', liveState);
      return data.live;
    }).catch(function (err) {
      liveState.status = 'error';
      liveState.errors = [String(err && err.message || err)];
      bus.emit('data:live', liveState);
      return null;
    });
    return liveState.promise;
  }

  /* PolicyFeeds.loadLive() RESOLVES even when a source failed: the failures come back
     in res.errors. So the freshness banner switches on this, not on the promise. */
  function liveStatus() {
    if (liveState.status === 'idle') return 'idle';
    if (liveState.status === 'loading') return 'loading';
    if (liveState.status === 'error') return 'error';
    var recs = (data.live && data.live.records) || [];
    if (liveState.errors && liveState.errors.length) return recs.length ? 'partial' : 'error';
    return 'ok';
  }

  /* ==========================================================
     8. The plan. Lives here, not in Mode C.
     ========================================================== */

  function emptyPlan() {
    return {
      v: 1, discipline: null,
      target: { change: '', changes: '', waiting: '', reach: '', forcing: '', offtable: '', gov: '' },
      openings: [], artefacts: [], words: {}, contactsLog: []
    };
  }

  var plan = emptyPlan();
  var planShared = false;        /* opened from a ?p= link */
  var planSchemaTooNew = false;  /* written by a newer build */
  function planReadOnlyNow() { return planShared || planSchemaTooNew; }

  var savePlan = debounce(function () {
    try { store('pt-plan', JSON.stringify(plan)); } catch (e) {}
  }, 400);

  function planChanged() {
    if (!planReadOnlyNow()) savePlan();
    renderModebar();
    bus.emit('plan:change', plan);
  }

  var planApi = {
    add: function (record) {
      if (!record || !record.id) return false;
      if (planApi.has(record.id)) return false;
      plan.openings.push({
        id: record.id, title: record.title, closes: record.closes || null,
        policyStage: record.policyStage, source_url: record.source_url, source_kind: record.source_kind
      });
      if (!plan.discipline && state.discipline) plan.discipline = state.discipline;
      planChanged();
      announce('Added to your plan. ' + plan.openings.length + ' ' + plural(plan.openings.length, 'opening') + '.');
      return true;
    },
    remove: function (id) {
      var before = plan.openings.length;
      plan.openings = plan.openings.filter(function (o) { return o.id !== id; });
      delete plan.words[id];
      if (plan.openings.length !== before) {
        planChanged();
        announce('Removed from your plan. ' + plan.openings.length + ' ' + plural(plan.openings.length, 'opening') + '.');
        return true;
      }
      return false;
    },
    has: function (id) { return plan.openings.some(function (o) { return o.id === id; }); },
    count: function () { return plan.openings.length; },
    get: function () { try { return JSON.parse(JSON.stringify(plan)); } catch (e) { return emptyPlan(); } },
    setField: function (path, value) {
      var parts = String(path).split('.');
      var node = plan;
      for (var i = 0; i < parts.length - 1; i++) {
        if (node[parts[i]] === undefined || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = value;
      planChanged();
    },
    addContact: function () {
      plan.contactsLog.push({ name: '', role: '', met: '', notes: '', next: '' });
      planChanged();
    },
    removeContact: function (i) {
      plan.contactsLog.splice(i, 1);
      planChanged();
    },
    toggleArtefact: function (key) {
      var i = plan.artefacts.indexOf(key);
      if (i > -1) plan.artefacts.splice(i, 1); else plan.artefacts.push(key);
      planChanged();
    },
    replaceWith: function (obj) {
      plan = Object.assign(emptyPlan(), obj || {});
      planShared = false;
      planSchemaTooNew = false;
      planShareHash = null;
      planChanged();
    },
    clear: function () { plan = emptyPlan(); planChanged(); },
    isReadOnly: function () { return planReadOnlyNow(); },
    isShared: function () { return planShared; },
    setShared: function (v) { planShared = !!v; },
    schemaTooNew: function () { return planSchemaTooNew; }
  };

  /* Share encoding, spec 2.3. */
  function toShare(p) {
    return {
      v: 1, d: p.discipline || null,
      t: { c: p.target.change, w: p.target.changes, r: p.target.waiting,
           x: p.target.reach, f: p.target.forcing, o: p.target.offtable, g: p.target.gov },
      o: p.openings.map(function (x) { return x.id; }),
      a: p.artefacts.slice(),
      w: Object.assign({}, p.words),
      k: p.contactsLog.map(function (c) { return { n: c.name, r: c.role, d: c.met, s: c.notes, x: c.next }; })
    };
  }
  function fromShare(s) {
    var p = emptyPlan();
    if (!s || typeof s !== 'object') return p;
    p.discipline = s.d || null;
    var t = s.t || {};
    p.target = { change: t.c || '', changes: t.w || '', waiting: t.r || '',
                 reach: t.x || '', forcing: t.f || '', offtable: t.o || '', gov: t.g || '' };
    p.artefacts = Array.isArray(s.a) ? s.a.slice() : [];
    p.words = s.w || {};
    p.contactsLog = (Array.isArray(s.k) ? s.k : []).map(function (c) {
      return { name: c.n || '', role: c.r || '', met: c.d || '', notes: c.s || '', next: c.x || '' };
    });
    p.openings = (Array.isArray(s.o) ? s.o : []).map(function (id) {
      var found = data.openings.filter(function (r) { return r.id === id; })[0];
      if (found) {
        return { id: found.id, title: found.title, closes: found.closes || null,
                 policyStage: found.policyStage, source_url: found.source_url, source_kind: found.source_kind };
      }
      return { id: id, title: null, closes: null, policyStage: null, source_url: null, source_kind: null, _orphan: true };
    });
    return p;
  }
  function encodePlan(p) {
    try {
      var json = JSON.stringify(toShare(p));
      var bytes = new TextEncoder().encode(json);
      var bin = '';
      bytes.forEach(function (b) { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { return null; }
  }
  function decodePlan(s) {
    try {
      var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return fromShare(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (e) { return null; }
  }

  /* ==========================================================
     9. Shell
     ========================================================== */

  function announce(text) {
    var live = document.getElementById('pt-live');
    if (!live) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  function feedbackHref(mode) {
    var m = mode || state.mode;
    var subject = 'Policy Pathways prototype: mode ' + m
      + (state.discipline ? ', field ' + state.discipline : '');
    if (/^mailto:/i.test(FEEDBACK_URL)) {
      return FEEDBACK_URL + '?subject=' + encodeURIComponent(subject);
    }
    if (/github\.com\/.+\/issues\/new/i.test(FEEDBACK_URL)) {
      return FEEDBACK_URL + '?title=' + encodeURIComponent(subject);
    }
    return FEEDBACK_URL + (FEEDBACK_URL.indexOf('?') > -1 ? '&' : '?')
      + 'mode=' + encodeURIComponent(m)
      + (state.discipline ? '&discipline=' + encodeURIComponent(state.discipline) : '');
  }

  function renderMasthead() {
    var host = document.getElementById('pt-masthead');
    if (!host) return;
    clear(host);
    var w = el('div', 'wrap');

    var brand = el('div', 'brand');
    var h1 = el('h1', null, 'Federal Policy Pathways');
    brand.appendChild(h1);
    brand.appendChild(el('p', null, 'Find your opening in federal policy, and build the plan to use it.'));
    w.appendChild(brand);

    var col = el('div', 'pt-masthead__col');
    var chips = el('div', 'chips');
    chips.appendChild(chip('Prototype', 'accent'));
    chips.appendChild(chip('Federal layer'));
    if (data.stages && data.stages.verified_on) {
      chips.appendChild(chip('Verified ' + dateLabel(data.stages.verified_on)));
    }
    col.appendChild(chips);

    var links = el('div', 'pt-masthead__links');
    var a1 = el('a', 'pt-masthead__link', 'The explainer');
    a1.href = '../';
    links.appendChild(a1);
    var a2 = el('a', 'pt-masthead__link pt-masthead__link--feedback', 'Tell us what is missing');
    a2.href = feedbackHref();
    links.appendChild(a2);
    col.appendChild(links);
    w.appendChild(col);

    host.appendChild(w);
  }

  var MODE_META = [
    ['walk', 'Walk it', 'The six policy stages, read for your field.'],
    ['openings', 'Openings', 'What is open now, and how to use it.'],
    ['plan', 'Plan it', 'Your targets, dates and artefacts, saved here.']
  ];

  function renderModebar() {
    var host = document.getElementById('pt-modebar');
    if (!host) return;
    clear(host);
    var w = el('div', 'wrap');
    MODE_META.forEach(function (m) {
      var b = el('button');
      b.type = 'button';
      b.id = 'pt-tab-' + m[0];
      b.setAttribute('aria-pressed', String(state.mode === m[0]));
      var label = el('span', 'pt-modebar__label', m[1]);
      if (m[0] === 'plan' && planApi.count() > 0) {
        label.appendChild(el('span', 'pt-modebar__count', String(planApi.count())));
        b.setAttribute('aria-label', 'Plan it, ' + planApi.count() + ' ' + plural(planApi.count(), 'opening'));
      }
      b.appendChild(label);
      b.appendChild(el('span', 'pt-modebar__sub', m[2]));
      b.addEventListener('click', function () { go('#/' + m[0]); });
      w.appendChild(b);
    });
    host.appendChild(w);
  }

  function renderContextbar() {
    var host = document.getElementById('pt-context');
    if (!host) return;
    clear(host);
    var d = state.discipline && data.disciplineById ? data.disciplineById.get(state.discipline) : null;
    var showStage = state.mode === 'walk';
    if (!d && !showStage) { host.hidden = true; return; }
    host.hidden = false;
    host.className = 'pt-contextbar' + (d ? ' has-discipline' : '');

    var w = el('div', 'wrap');
    if (d) {
      var item = el('span', 'pt-contextbar__item');
      item.appendChild(document.createTextNode('Field: '));
      var link = el('a', null, d.name);
      link.href = '#/start';
      item.appendChild(link);
      var x = el('button', 'pt-contextbar__clear');
      x.type = 'button';
      x.setAttribute('aria-label', 'Clear field');
      x.textContent = '×';
      x.addEventListener('click', function () { setState({ discipline: null }); });
      item.appendChild(x);
      w.appendChild(item);
    }
    if (showStage) {
      var s2 = el('span', 'pt-contextbar__item');
      s2.appendChild(document.createTextNode('Policy stage '));
      s2.appendChild(el('b', null, String(state.policyStage)));
      w.appendChild(s2);
    }
    var restart = el('a', 'pt-contextbar__restart', 'Start over');
    restart.href = '#/start';
    w.appendChild(restart);
    host.appendChild(w);
  }

  function renderFooter() {
    var host = document.getElementById('pt-footer');
    if (!host) return;
    clear(host);
    var w = el('div', 'wrap');
    w.appendChild(el('span', null, 'Prototype. Federal layer. Quebec and other provinces to follow.'));
    w.appendChild(el('span', null, 'Built for Pathways to Impact, Concordia University.'));
    host.appendChild(w);
  }

  function renderNotices() {
    var host = document.getElementById('pt-notices');
    if (!host) return;
    clear(host);
    var w = el('div', 'wrap');
    var any = false;
    if (storageBroken) {
      w.appendChild(banner('warn', 'This browser is not saving your plan. Download it before you close the tab.'));
      any = true;
    }
    if (data.failed.length) {
      var names = data.failed.map(function (k) { return FILE_LABEL[k] || k; }).join(', ');
      w.appendChild(banner('warn', names + ' did not load. The rest of the tool works. Some panels will be thinner than usual.'));
      any = true;
    }
    host.hidden = !any;
    if (any) host.appendChild(w);
  }

  function renderShell() {
    renderMasthead();
    renderModebar();
    renderContextbar();
    renderNotices();
    renderFooter();
  }

  /* ==========================================================
     10. The front doors. app.js owns them, registered as a mode
         so the router treats all four uniformly.
     ========================================================== */

  function highlight(text, term) {
    var box = document.createDocumentFragment();
    if (!term) { box.appendChild(document.createTextNode(text)); return box; }
    var i = text.toLowerCase().indexOf(term.toLowerCase());
    if (i === -1) { box.appendChild(document.createTextNode(text)); return box; }
    box.appendChild(document.createTextNode(text.slice(0, i)));
    box.appendChild(el('mark', null, text.slice(i, i + term.length)));
    box.appendChild(document.createTextNode(text.slice(i + term.length)));
    return box;
  }

  function disciplineMatches(d, term) {
    if (!term) return true;
    var t = term.toLowerCase();
    var hay = [d.name].concat(d.crdc_groups || [], d.lead_departments || [], d.committees || []);
    return hay.some(function (s) { return String(s).toLowerCase().indexOf(t) > -1; });
  }

  var doorsSearch = '';

  var startMode = {
    init: function () {},
    render: function (ctx) {
      var out = ctx.outlet;
      var page = el('div', 'pt-doors');
      var w = el('div', 'wrap');

      /* Door one: situations */
      var b1 = el('section', 'pt-doors__block');
      var h2a = el('h2', null, "What's your situation?");
      h2a.tabIndex = -1;
      b1.appendChild(h2a);
      b1.appendChild(el('p', 'pt-doors__sub', 'Pick the one that sounds like this week. It opens the policy stage that matches.'));
      var sits = data.situations && data.situations.situations;
      if (!sits || !sits.length) {
        b1.appendChild(el('p', 'pt-doors__sub', 'The situation cards did not load. Pick a field instead.'));
      } else {
        var ul = el('ul', 'pt-situations');
        sits.forEach(function (s) {
          var li = el('li');
          var btn = el('button', 'pt-situation');
          btn.type = 'button';
          btn.appendChild(el('span', 'pt-situation__label', s.label));
          if (s.note) btn.appendChild(el('span', 'pt-situation__note', s.note));
          var viewLabel = s.view === 'influence' ? 'Your opening' : (s.view === 'both' ? 'Both views' : 'The machine');
          btn.appendChild(el('span', 'pt-situation__target', 'Policy stage ' + s.policyStage + ', ' + viewLabel));
          btn.addEventListener('click', function () {
            go(s.route || ('#/walk/s' + s.policyStage + '-' + (s.view || 'process')));
          });
          li.appendChild(btn);
          ul.appendChild(li);
        });
        b1.appendChild(ul);
      }
      w.appendChild(b1);

      /* Door two: fields */
      var b2 = el('section', 'pt-doors__block');
      b2.id = 'pt-door-fields';
      var h2b = el('h2', null, "What's your field?");
      h2b.tabIndex = -1;
      b2.appendChild(h2b);
      b2.appendChild(el('p', 'pt-doors__sub', 'Your field changes who your actors are and where your realistic opening is. It does not change how government works.'));

      var list = data.disciplines && data.disciplines.disciplines;
      if (!list || !list.length) {
        b2.appendChild(empty({
          title: 'Fields did not load.',
          body: 'The tool still works. Walk the six policy stages without a field, or reload the page.',
          actionLabel: 'Walk it',
          onAction: function () { go('#/walk/s1-process'); }
        }));
      } else {
        var search = el('input');
        search.type = 'search';
        search.id = 'pt-discipline-search';
        search.placeholder = 'Type a field, a department or a committee';
        search.value = doorsSearch;
        var sf = field('Search fields', search);
        sf.className = 'pt-field pt-picker__search';
        b2.appendChild(sf);

        var results = el('div', 'pt-picker');
        b2.appendChild(results);

        var paint = function () {
          clear(results);
          var term = doorsSearch.trim();
          var order = CRDC_DIVISIONS.slice();
          var groups = new Map();
          list.forEach(function (d) {
            var div = d.division;
            if (order.indexOf(div) === -1) div = 'Other fields';
            if (!groups.has(div)) groups.set(div, []);
            groups.get(div).push(d);
          });
          order.push('Other fields');
          var shown = 0;
          order.forEach(function (div) {
            var items = (groups.get(div) || []).filter(function (d) { return disciplineMatches(d, term); });
            if (!items.length) return;
            shown += items.length;
            var g = el('section', 'pt-picker__group');
            g.appendChild(el('h3', null, div));
            var ul2 = el('ul', 'pt-picker__list');
            items.forEach(function (d) {
              var li = el('li');
              var btn = el('button', 'pt-discipline' + (state.discipline === d.id ? ' is-selected' : ''));
              btn.type = 'button';
              if (state.discipline === d.id) btn.setAttribute('aria-current', 'true');
              var name = el('span', 'pt-discipline__name');
              name.appendChild(highlight(d.name, term));
              btn.appendChild(name);
              btn.appendChild(chip(null, d.confidence === 'verified' ? 'verified' : 'check'));
              btn.addEventListener('click', function () {
                var best = (d.best_stages && d.best_stages[0] && d.best_stages[0].policyStage) || 1;
                go('#/walk/s' + best + '-influence?d=' + encodeURIComponent(d.id));
              });
              li.appendChild(btn);
              ul2.appendChild(li);
            });
            g.appendChild(ul2);
            results.appendChild(g);
          });
          if (!shown) {
            results.appendChild(empty({
              title: 'No field matches "' + term + '".',
              body: 'Twenty-three fields are listed. Try a broader word, a department, or a committee acronym.',
              actionLabel: 'Clear search',
              onAction: function () { doorsSearch = ''; search.value = ''; paint(); }
            }));
          }
        };
        search.addEventListener('input', debounce(function () {
          doorsSearch = search.value;
          paint();
        }, 250));
        paint();
      }
      w.appendChild(b2);
      page.appendChild(w);
      out.appendChild(page);
    },
    destroy: function () {}
  };

  /* ==========================================================
     11. Mode activation and boot
     ========================================================== */

  var activeMode = null;
  var modeListeners = [];

  function ctx() {
    return {
      state: snapshot(),
      data: data,
      outlet: document.getElementById('pt-outlet'),
      ui: ui,
      format: format,
      bus: bus,
      go: go,
      setState: setState,
      plan: planApi,
      planShare: { encode: encodePlan, decode: decodePlan },
      loadLive: loadLive,
      liveState: liveState,
      liveStatus: liveStatus,
      tipFor: tipFor,
      artefactTime: artefactTime,
      ownerFor: ownerFor,
      announce: announce,
      debounce: debounce,
      feedbackHref: feedbackHref,
      on: function (target, evt, fn, opts) {
        target.addEventListener(evt, fn, opts);
        modeListeners.push([target, evt, fn, opts]);
      },
      off: function (target, evt, fn, opts) {
        target.removeEventListener(evt, fn, opts);
      }
    };
  }

  function teardownListeners() {
    modeListeners.forEach(function (l) {
      try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) {}
    });
    modeListeners = [];
  }

  function modeFor(name) {
    if (name === 'start') return startMode;
    return PolicyTool.modes[name] || null;
  }

  function activate(name) {
    var outlet = document.getElementById('pt-outlet');
    if (activeMode && activeMode !== name) {
      var prev = modeFor(activeMode);
      if (prev && typeof prev.destroy === 'function') {
        try { prev.destroy(); } catch (e) { console.warn('PolicyTool: destroy of ' + activeMode + ' threw', e); }
      }
      teardownListeners();
    }
    clear(outlet);
    activeMode = name;
    var m = modeFor(name);
    if (!m) {
      outlet.appendChild(wrap(empty({
        title: 'This mode is not built yet.',
        body: 'The file that renders it is not loaded. Walk it works, and so does the front door.',
        actionLabel: 'Back to the start',
        onAction: function () { go('#/start'); }
      })));
      renderShell();
      bus.emit('mode:change', name);
      return;
    }
    /* init runs on every ACTIVATION, not once per page load. app.js tears down every
       ctx.on listener when a mode is deactivated, so a mode returning to the screen
       has to register them again. Symmetric lifecycle, no stale listeners. */
    if (typeof m.init === 'function') m.init(ctx());
    m.render(ctx());
    renderShell();
    focusModeHeading();
    announceMode(name);
    bus.emit('mode:change', name);
  }

  /* Clearing the outlet blurs whatever was focused inside it, synchronously, before
     any mode's render() runs. So the only place that can still see "the search box
     was focused" is here, immediately before the clear. Captured by element id, not
     by node reference, because the node itself is about to be destroyed. Every mode
     gets this for free and none of them should implement it again. */
  var pendingFocus = null;

  function captureFocus() {
    var a = document.activeElement;
    var outlet = document.getElementById('pt-outlet');
    if (!a || !a.id || !outlet || !outlet.contains(a)) { pendingFocus = null; return; }
    pendingFocus = {
      id: a.id,
      start: (typeof a.selectionStart === 'number') ? a.selectionStart : null,
      end: (typeof a.selectionEnd === 'number') ? a.selectionEnd : null
    };
  }

  function restoreFocus() {
    var want = pendingFocus;
    pendingFocus = null;
    if (!want) return;
    var node = document.getElementById(want.id);
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
    if (want.start !== null) {
      try { node.setSelectionRange(want.start, want.end); } catch (e) {}
    }
  }

  function renderActive() {
    var m = modeFor(activeMode);
    if (!m) return;
    var outlet = document.getElementById('pt-outlet');
    captureFocus();
    clear(outlet);
    m.render(ctx());
    restoreFocus();
  }

  function focusModeHeading() {
    var outlet = document.getElementById('pt-outlet');
    var h2 = outlet.querySelector('h2');
    if (h2) {
      if (!h2.hasAttribute('tabindex')) h2.tabIndex = -1;
      try { h2.focus({ preventScroll: true }); } catch (e) { h2.focus(); }
    }
  }

  function announceMode(name) {
    if (name === 'walk') {
      announce('Walk it. Policy stage ' + state.policyStage + ' of 6.');
    } else if (name === 'openings') {
      announce('Openings. ' + data.openings.length + ' ' + plural(data.openings.length, 'opening') + '.');
    } else if (name === 'plan') {
      announce('Plan it. ' + planApi.count() + ' ' + plural(planApi.count(), 'opening') + '.');
    } else {
      announce('Start. Two ways in: your situation, or your field.');
    }
  }

  function setState(patch) {
    var wasMode = state.mode;
    Object.keys(patch || {}).forEach(function (k) {
      if (k === 'filters') Object.assign(state.filters, patch.filters);
      else state[k] = patch[k];
    });
    if (state.policyStage < 1) state.policyStage = 1;
    if (state.policyStage > 6) state.policyStage = 6;
    if (VIEWS.indexOf(state.view) === -1) state.view = 'process';
    persist();
    var modeChanged = state.mode !== wasMode;
    writeHash(modeChanged);
    if (modeChanged) activate(state.mode);
    else { renderActive(); renderShell(); }
    bus.emit('state:change', snapshot());
  }

  function go(hash) {
    var p = parseHash(hash);
    if (!p) return;
    var wasMode = state.mode;
    if (p.mode !== 'openings') {
      state.filters.stage = null; state.filters.closes = null;
      state.filters.open = null; state.filters.kinds = []; state.filters.q = '';
    }
    applyParsed(p);
    persist();
    writeHash(p.mode !== wasMode);
    if (p.mode !== wasMode) activate(state.mode);
    else { renderActive(); renderShell(); }
    bus.emit('state:change', snapshot());
  }

  function restoreFromStorage() {
    var m = read('pt-mode');
    var s = +read('pt-stage');
    var v = read('pt-view');
    var d = read('pt-discipline');
    if (MODES.indexOf(m) > -1) state.mode = m;
    if (s >= 1 && s <= 6) state.policyStage = s;
    if (VIEWS.indexOf(v) > -1) state.view = v;
    if (d && data.disciplineById && data.disciplineById.get(d)) state.discipline = d;
    try {
      var f = JSON.parse(read('pt-filters') || 'null');
      if (f && typeof f === 'object') {
        state.filters.stage = f.stage || null;
        state.filters.closes = f.closes || null;
        state.filters.open = f.open || null;
        state.filters.kinds = Array.isArray(f.kinds) ? f.kinds : [];
      }
    } catch (e) {}
    try {
      var raw = read('pt-plan');
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') plan = Object.assign(emptyPlan(), saved);
      }
    } catch (e) {}

    /* Spec 2.4. Two signals, either one is enough: the storage-wide pt-schema stamp
       and the plan's own v. A plan written by a newer build is left exactly as it is,
       rendered read-only, so this version cannot quietly drop fields it does not
       understand the next time it autosaves. */
    var stamp = parseInt(read('pt-schema'), 10);
    if ((!isNaN(stamp) && stamp > SCHEMA) || (plan && +plan.v > SCHEMA)) {
      planSchemaTooNew = true;
    }
  }

  function bootError(message, detail) {
    var outlet = document.getElementById('pt-outlet');
    clear(outlet);
    outlet.appendChild(wrap(empty({
      title: message,
      body: detail,
      actionLabel: 'Reload',
      onAction: function () { location.reload(); }
    })));
  }

  function boot() {
    renderShell();
    var outlet = document.getElementById('pt-outlet');
    var loading = wrap(empty({ title: 'Loading.', body: 'Fetching the policy stages.' }));
    outlet.appendChild(loading);

    loadAll().then(function () {
      if (!data.stages || !data.stages.stages || data.stages.stages.length !== 6) {
        bootError('The policy stages did not load.',
          'Reload the page. If it keeps failing, data/stages.json is missing or malformed.');
        return;
      }
      restoreFromStorage();

      var parsed = parseHash(location.hash);
      if (parsed) {
        applyParsed(parsed);
        if (parsed.upgraded) writeHash(false);
      } else if (!read('pt-seen-doors')) {
        state.mode = 'start';
      }

      /* A shared plan renders read-only and never overwrites what is here. */
      if (state.mode === 'plan' && parsed && parsed.query && parsed.query.p) {
        var shared = decodePlan(parsed.query.p);
        if (shared) {
          planShareHash = location.hash;
          plan = shared;
          planApi.setShared(true);
        }
      }

      clear(outlet);
      renderShell();
      writeHash(false);
      activate(state.mode);

      renderNotices();

      window.addEventListener('popstate', onHistory);
      window.addEventListener('hashchange', onHistory);
    }).catch(function (err) {
      console.warn('PolicyTool: boot failed', err);
      bootError('The tool did not start.', 'Reload the page. The data files may be unreachable from here.');
    });
  }

  /* ==========================================================
     12. Export
     ========================================================== */

  var PolicyTool = {
    version: '0.1.0',
    modes: { start: startMode },
    boot: boot,
    bus: bus,
    ui: ui,
    format: format,
    data: data,
    plan: planApi,
    planShare: { encode: encodePlan, decode: decodePlan },
    go: go,
    setState: setState,
    loadLive: loadLive,
    liveState: liveState,
    liveStatus: liveStatus,
    tipFor: tipFor,
    artefactTime: artefactTime,
    ownerFor: ownerFor,
    announce: announce,
    debounce: debounce,
    feedbackHref: feedbackHref,
    rebuildOpenings: rebuildOpenings,
    constants: {
      MODES: MODES, VIEWS: VIEWS, DOMAINS: DOMAINS, CRDC_DIVISIONS: CRDC_DIVISIONS,
      SOURCE_KIND_LABEL: SOURCE_KIND_LABEL, DATA_BASE: DATA_BASE, FEEDBACK_URL: FEEDBACK_URL
    }
  };

  window.PolicyTool = PolicyTool;
})();
