/* Mode B: Openings.
   tool/mode-openings.js. Owner: Sonnet UI. Built to docs/design-spec.md 3.10 to 3.13,
   4.3 to 4.5. Follows tool/mode-walk.js's five rules exactly: one registration, the
   same cur stash refreshed at the top of render, ctx.on for every global listener
   registered in init, an idempotent render, and every card, chip, meter, empty state
   and banner built only through ctx.ui.

   Two things this file adds beyond mode-walk's patterns, both explained where they
   happen: a resize-driven collapse for the filter bar (the same technique as
   mode-walk's applyView, applied to a <details> instead of a segmented control),
   and a plan:change listener that patches one card in place instead of re-rendering
   the board, because a board of up to roughly a hundred cards should not be rebuilt
   every time a reader clicks one button. */

(function () {
  'use strict';

  var cur = null;            /* latest ctx, refreshed on every render */
  var nodes = {};             /* DOM handles this file needs after render */
  var openingsById = {};      /* id -> record, for the plan:change patch and lookups */

  var liveRequested = false;  /* ctx.loadLive() is called on first activation only */
  var newsRequested = false;
  var newsItems = null;       /* null until loadNews() resolves; [] is a valid answer */

  var filterOpen = false;     /* the collapsed filter bar's own open/closed state */
  var pendingPatch = null;    /* coalesced, debounced state.filters/discipline patch */
  var pendingTimer = null;

  var onPlanChange = null;    /* bound per activation, unbound in destroy */
  var onDataLive = null;

  var hasRendered = false;    /* guards against a re-render fired from inside init(),
                                  before app.js's own first render() has ever run */

  var KIND_ORDER = ['consultation', 'bill', 'gazette', 'tender', 'committee', 'funding', 'appointment', 'review'];
  var CLOSES_OPTIONS = [['', 'Any time'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['standing', 'Standing']];
  var OPEN_OPTIONS = [['', 'All openings'], ['anyone', 'Anyone'], ['organisation', 'Organizations'], ['parliamentarian', 'Parliamentarian required']];

  /* ---------- small helpers ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function hoursSince(iso) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    return (Date.now() - t) / 3600000;
  }

  function timeLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function wideEnough() {
    try { return window.matchMedia('(min-width: 700px)').matches; } catch (e) { return true; }
  }

  /* app.js captures and restores focus by element id around every renderActive(),
     so a fast typist keeps the search box and the caret. Nothing to do here. */
  function refresh(patch) {
    if (cur) cur.setState(patch || {});
  }

  /* Filter and search writes are debounced at 250ms (spec 2.2). Every control funnels
     through this one coalescing timer so a burst of changes across controls, or a
     fast typist in the search box, produces one ctx.setState call, not one per event. */
  function queuePatch(patch) {
    if (!pendingPatch) pendingPatch = {};
    Object.keys(patch).forEach(function (k) {
      if (k === 'filters') pendingPatch.filters = Object.assign(pendingPatch.filters || {}, patch.filters);
      else pendingPatch[k] = patch[k];
    });
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      var p = pendingPatch;
      pendingPatch = null;
      pendingTimer = null;
      refresh(p);
    }, 250);
  }
  function applyPatchNow(patch) {
    pendingPatch = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    refresh(patch);
  }

  function clearAllFilters() {
    applyPatchNow({ discipline: null, filters: { stage: null, domain: null, closes: null, open: null, kinds: [], q: '' } });
  }
  function clearSearch() {
    applyPatchNow({ filters: { q: '' } });
  }

  function activeFilterCount(ctx) {
    var f = ctx.state.filters, n = 0;
    if (f.stage) n++;
    if (ctx.state.discipline) n++;
    if (f.closes) n++;
    if (f.open) n++;
    if (f.kinds && f.kinds.length) n++;
    if (f.q) n++;
    return n;
  }

  /* ---------- filtering ---------- */

  function disciplineMatchesRecord(disc, record) {
    if (!disc || !disc.domains || !record.domains) return false;
    return record.domains.some(function (d) { return disc.domains.indexOf(d) > -1; });
  }

  function matchesNonSearch(ctx, r) {
    var f = ctx.state.filters;
    if (f.stage && r.policyStage !== f.stage) return false;
    if (ctx.state.discipline) {
      var disc = ctx.data.disciplineById && ctx.data.disciplineById.get(ctx.state.discipline);
      if (!disciplineMatchesRecord(disc, r)) return false;
    }
    if (f.closes) {
      var standing = ctx.format.isStanding(r);
      if (f.closes === 'standing') {
        if (!standing) return false;
      } else {
        if (standing) return false;
        var d = ctx.format.daysUntil(r.closes);
        if (d === null || d < 0 || d > (+f.closes)) return false;
      }
    }
    if (f.open && r.open_to !== f.open) return false;
    if (f.kinds && f.kinds.length && f.kinds.indexOf(r.source_kind) === -1) return false;
    return true;
  }

  function matchesQuery(ctx, r, q) {
    var needle = q.trim().toLowerCase();
    if (!needle) return true;
    var owner = ctx.ownerFor(r);
    var hay = [r.title, r.body, owner].filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(needle) > -1;
  }

  function computeVisible(ctx) {
    var all = ctx.data.openings || [];
    var withoutSearch = all.filter(function (r) { return matchesNonSearch(ctx, r); });
    var q = ctx.state.filters.q;
    var final = q ? withoutSearch.filter(function (r) { return matchesQuery(ctx, r, q); }) : withoutSearch;
    return { all: all, withoutSearch: withoutSearch, final: final };
  }

  /* ---------- freshness banner, 3.12 and 4.4 ---------- */

  function liveLineText(ctx) {
    var status = ctx.liveStatus();
    if (status === 'idle' || status === 'loading') {
      return { text: 'Checking open.canada.ca for live consultations.', warn: false, error: false };
    }
    if (status === 'error') {
      return { text: 'Live consultations did not load. The board below is the daily build plus the curated list, so it still works.', warn: false, error: true, retry: true };
    }
    var fetchedAt = ctx.liveState.fetched_at;
    var hrs = fetchedAt ? hoursSince(fetchedAt) : null;
    var text;
    if (hrs !== null && hrs * 60 < 2) {
      text = 'Consultations live from open.canada.ca, fetched just now.';
    } else if (fetchedAt) {
      text = 'Consultations live from open.canada.ca, fetched at ' + timeLabel(fetchedAt) + '.';
    } else {
      text = 'Consultations live from open.canada.ca.';
    }
    if (status === 'partial' && ctx.liveState.errors && ctx.liveState.errors.length) {
      text += ' ' + ctx.liveState.errors.length + ' ' + ctx.format.plural(ctx.liveState.errors.length, 'live source', 'live sources') + ' did not load.';
    }
    return { text: text, warn: false, error: false };
  }

  function buildLineText(ctx) {
    if (!ctx.data.feeds) {
      return { text: 'The daily build did not load. Curated items below are unaffected.', warn: false };
    }
    var builtAt = ctx.data.feeds.built_at;
    var hrs = builtAt ? hoursSince(builtAt) : null;
    var text, warn = false;
    if (hrs !== null && hrs < 48) {
      text = 'Bills, Gazette and tenders updated ' + ctx.format.dateLabel(builtAt) + '.';
    } else if (builtAt) {
      text = 'Bills, Gazette and tenders last updated ' + ctx.format.dateLabel(builtAt) + ', more than 48 hours ago. Check the source before you rely on a date.';
      warn = true;
    } else {
      text = 'The daily build did not load. Curated items below are unaffected.';
    }
    if (ctx.data.dropped) {
      text += ' ' + ctx.data.dropped + ' ' + ctx.format.plural(ctx.data.dropped, 'record was', 'records were') + ' skipped because ' +
        ctx.format.plural(ctx.data.dropped, 'it was', 'they were') + ' missing a date or a source.';
    }
    return { text: text, warn: warn };
  }

  function retryLive() {
    if (!cur) return;
    cur.loadLive();
  }

  function renderFreshness(ctx) {
    var el = ctx.ui.el;
    var box = el('div', 'pt-freshness');
    box.setAttribute('role', 'status');

    var live = liveLineText(ctx);
    var liveLine = el('p', 'pt-freshness__line pt-freshness__line--live' + (live.error ? ' pt-freshness__line--error' : ''));
    liveLine.appendChild(document.createTextNode(live.text));
    if (live.retry) liveLine.appendChild(ctx.ui.button('Retry', { onClick: retryLive }));
    box.appendChild(liveLine);

    var build = buildLineText(ctx);
    var buildLine = el('p', 'pt-freshness__line pt-freshness__line--build' + (build.warn ? ' pt-freshness__line--warn' : ''));
    buildLine.textContent = build.text;
    box.appendChild(buildLine);

    var curLine = el('p', 'pt-freshness__line pt-freshness__line--curated', 'Curated items each show their check date.');
    box.appendChild(curLine);

    box.appendChild(ctx.ui.sittingLine());
    return box;
  }

  /* ---------- filter bar, 3.11 ---------- */

  function stageOptions(ctx) {
    var stages = (ctx.data.stages && ctx.data.stages.stages) || [];
    return [['', 'All policy stages']].concat(stages.map(function (s) {
      return [String(s.id), s.id + '. ' + s.short];
    }));
  }

  function domainOptions(ctx) {
    var list = (ctx.data.disciplines && ctx.data.disciplines.disciplines) || [];
    return [['', 'All fields']].concat(list.map(function (d) { return [d.id, d.name]; }));
  }

  function makeSelect(ctx, id, labelText, options, current, onChange) {
    var el = ctx.ui.el;
    var select = document.createElement('select');
    select.id = id;
    options.forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      if (pair[0] === (current || '')) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () { onChange(select.value); });
    return ctx.ui.field(labelText, select);
  }

  function renderKindChips(ctx, presentKinds) {
    var el = ctx.ui.el;
    var box = el('div', 'pt-filterbar__kinds');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Source kind');
    var kinds = ctx.state.filters.kinds || [];
    presentKinds.forEach(function (kind) {
      var pressed = kinds.indexOf(kind) > -1;
      box.appendChild(ctx.ui.kindChip(kind, pressed, function () {
        var next = kinds.slice();
        var i = next.indexOf(kind);
        if (i > -1) next.splice(i, 1); else next.push(kind);
        queuePatch({ filters: { kinds: next } });
      }));
    });
    return box;
  }

  function presentKindsIn(records) {
    var seen = {};
    records.forEach(function (r) { seen[r.source_kind] = true; });
    return KIND_ORDER.filter(function (k) { return seen[k]; });
  }

  function applyFilterCollapse() {
    if (!nodes.filterDetails) return;
    var wide = wideEnough();
    nodes.filterDetails.open = wide ? true : filterOpen;
    nodes.filterDetails.classList.toggle('pt-filterbar--collapsed', !wide);
  }

  function renderFilterBar(ctx, countInfo) {
    var el = ctx.ui.el;
    var details = document.createElement('details');
    details.className = 'pt-filterbar';
    details.addEventListener('toggle', function () { filterOpen = details.open; });

    var active = activeFilterCount(ctx);
    var summary = document.createElement('summary');
    summary.textContent = active ? 'Filters (' + active + ' active)' : 'Filters';
    details.appendChild(summary);

    var grid = el('div', 'pt-filterbar__grid');

    var search = document.createElement('input');
    search.type = 'search';
    search.id = 'pt-f-q';
    search.value = ctx.state.filters.q || '';
    search.addEventListener('input', function () { queuePatch({ filters: { q: search.value } }); });
    grid.appendChild(ctx.ui.field('Search openings', search));

    grid.appendChild(makeSelect(ctx, 'pt-f-stage', 'Policy stage', stageOptions(ctx), ctx.state.filters.stage ? String(ctx.state.filters.stage) : '', function (v) {
      queuePatch({ filters: { stage: v ? +v : null } });
    }));
    grid.appendChild(makeSelect(ctx, 'pt-f-domain', 'Field', domainOptions(ctx), ctx.state.discipline || '', function (v) {
      queuePatch({ discipline: v || null, filters: { domain: v || null } });
    }));
    grid.appendChild(makeSelect(ctx, 'pt-f-closes', 'Closes within', CLOSES_OPTIONS, ctx.state.filters.closes || '', function (v) {
      queuePatch({ filters: { closes: v || null } });
    }));
    grid.appendChild(makeSelect(ctx, 'pt-f-open', 'Open to', OPEN_OPTIONS, ctx.state.filters.open || '', function (v) {
      queuePatch({ filters: { open: v || null } });
    }));
    details.appendChild(grid);

    details.appendChild(renderKindChips(ctx, presentKindsIn(countInfo.all)));

    var foot = el('div', 'pt-filterbar__foot');
    var count = el('p', 'pt-filterbar__count');
    var n = countInfo.final.length;
    count.textContent = n + ' ' + ctx.format.plural(n, 'opening') + (active ? '. ' + active + ' ' + ctx.format.plural(active, 'filter') + ' active.' : '.');
    foot.appendChild(count);
    if (active) {
      var reset = ctx.ui.button('Clear filters', { variant: 'ghost', onClick: clearAllFilters });
      reset.id = 'pt-f-reset';
      foot.appendChild(reset);
    }
    details.appendChild(foot);

    nodes.filterDetails = details;
    return details;
  }

  /* ---------- board ---------- */

  function renderNothingNew(ctx, visible) {
    var status = ctx.liveStatus();
    if (status !== 'ok') return null;
    var live = ctx.data.live;
    if (!live || (live.records && live.records.length)) return null;
    var n = visible.final.length;
    if (!n) return null;
    return ctx.ui.banner('info', 'Checked today, nothing new. The ' + n + ' ' +
      ctx.format.plural(n, 'opening') + ' below ' + (n === 1 ? 'is' : 'are') + ' still live.');
  }

  function renderBoardOrEmpty(ctx, visible) {
    nodes.board = null;
    if (!visible.all.length) {
      return ctx.ui.wrap(ctx.ui.empty({
        title: 'Nothing is open right now.',
        body: 'That is unusual, so check the source links before you take it as read. The board rebuilds every morning.',
        actionLabel: 'Tell us what is missing',
        onAction: function () { window.location.href = ctx.feedbackHref('openings'); }
      }));
    }
    if (!visible.withoutSearch.length) {
      return ctx.ui.wrap(ctx.ui.empty({
        title: 'No openings match these filters.',
        body: visible.all.length + ' ' + ctx.format.plural(visible.all.length, 'opening') + ' ' +
          (visible.all.length === 1 ? 'is' : 'are') + ' open with the filters cleared.',
        actionLabel: 'Clear filters',
        onAction: clearAllFilters
      }));
    }
    if (!visible.final.length) {
      return ctx.ui.wrap(ctx.ui.empty({
        title: 'No openings match "' + ctx.state.filters.q + '".',
        body: 'Try a department, a committee acronym, or a shorter word.',
        actionLabel: 'Clear search',
        onAction: clearSearch
      }));
    }
    var ul = document.createElement('ul');
    ul.className = 'pt-board';
    openingsById = {};
    visible.final.forEach(function (r) {
      openingsById[r.id] = r;
      var li = document.createElement('li');
      li.appendChild(ctx.ui.openingCard(r, { inPlan: ctx.plan.has(r.id) }));
      ul.appendChild(li);
    });
    nodes.board = ul;
    return ul;
  }

  /* ---------- news strip, decorative, silent on failure ---------- */

  function requestNews(ctx) {
    if (newsRequested) return;
    newsRequested = true;
    if (!window.PolicyFeeds || typeof window.PolicyFeeds.loadNews !== 'function') return;
    window.PolicyFeeds.loadNews().then(function (items) {
      newsItems = Array.isArray(items) ? items.slice(0, 6) : [];
      if (newsItems.length && cur && cur.state.mode === 'openings') refresh();
    }).catch(function () { newsItems = []; });
  }

  function renderNewsStrip(ctx) {
    if (!newsItems || !newsItems.length) return null;
    var el = ctx.ui.el;
    var box = el('div', 'pt-newsstrip');
    box.appendChild(el('h3', null, 'In the news'));
    box.appendChild(el('p', 'pt-newsstrip__note', 'Announcements from canada.ca, unfiltered and unchecked by this tool.'));
    var ul = el('ul', 'pt-newsstrip__list');
    newsItems.forEach(function (item) {
      var li = el('li', 'pt-newsstrip__item');
      if (item.publishedDate) {
        var iso = String(item.publishedDate).slice(0, 10);
        var label = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? ctx.format.dateLabel(iso) : '';
        if (label) li.appendChild(el('span', 'pt-newsstrip__date', label));
      }
      var a = el('a', null, item.title || item.link);
      a.href = item.link;
      a.target = '_blank';
      a.rel = 'noopener';
      li.appendChild(a);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }

  /* ---------- plan:change: patch one card, never rebuild the board ---------- */

  function patchPlanCards() {
    if (!cur || cur.state.mode !== 'openings' || !nodes.board) return;
    var articles = nodes.board.querySelectorAll('.pt-opening');
    for (var i = 0; i < articles.length; i++) {
      var article = articles[i];
      var id = article.getAttribute('data-id');
      var record = openingsById[id];
      if (!record) continue;
      var shouldBeIn = cur.plan.has(id);
      var isIn = article.classList.contains('is-inplan');
      if (shouldBeIn !== isIn) {
        var fresh = cur.ui.openingCard(record, { inPlan: shouldBeIn });
        article.parentNode.replaceChild(fresh, article);
      }
    }
  }

  function handleDataLive() {
    /* ctx.loadLive() is called from init(), and loadLive() itself synchronously
       emits data:live with status "loading" before init() returns. Without the
       hasRendered guard that would trigger a setState (and a full re-render) before
       app.js has ever called this activation's own render(), which is redundant
       work, not a correctness bug, but avoidable. */
    if (!cur || cur.state.mode !== 'openings' || !hasRendered) return;
    refresh();
  }

  /* ---------- the mode ---------- */

  window.PolicyTool.modes.openings = {

    init: function (ctx) {
      cur = ctx;
      if (!liveRequested) {
        liveRequested = true;
        ctx.loadLive();
      }
      requestNews(ctx);

      onPlanChange = patchPlanCards;
      onDataLive = handleDataLive;
      ctx.bus.on('plan:change', onPlanChange);
      ctx.bus.on('data:live', onDataLive);

      ctx.on(window, 'resize', ctx.debounce(function () { applyFilterCollapse(); }, 150));
    },

    render: function (ctx) {
      cur = ctx;
      var el = ctx.ui.el;
      var page = el('div', 'pt-openings');
      var w = el('div', 'wrap');

      var h2 = el('h2', null, 'Openings');
      h2.tabIndex = -1;
      w.appendChild(h2);

      w.appendChild(renderFreshness(ctx));

      var visible = computeVisible(ctx);
      w.appendChild(renderFilterBar(ctx, visible));

      var notice = renderNothingNew(ctx, visible);
      if (notice) w.appendChild(notice);

      w.appendChild(renderBoardOrEmpty(ctx, visible));

      var news = renderNewsStrip(ctx);
      if (news) w.appendChild(news);

      page.appendChild(w);
      ctx.outlet.appendChild(page);

      /* The details element must be open before app.js can put focus back into an
         input inside it, and app.js restores focus immediately after render()
         returns, so the collapse has to be settled before then. */
      applyFilterCollapse();
      hasRendered = true;
    },

    destroy: function () {
      if (onPlanChange) window.PolicyTool.bus.off('plan:change', onPlanChange);
      if (onDataLive) window.PolicyTool.bus.off('data:live', onDataLive);
      onPlanChange = null;
      onDataLive = null;
      cur = null;
      nodes = {};
      openingsById = {};
      hasRendered = false;
    }
  };
})();
