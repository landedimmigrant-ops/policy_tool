/* Mode A: Walk it.
   tool/mode-walk.js. Owner: Opus UX. This is the reference implementation.
   Modes B and C follow these patterns exactly.

   The five rules this file demonstrates:
   1. Register one object on window.PolicyTool.modes. Touch nothing else at load time.
   2. init(ctx) runs once per ACTIVATION of the mode, not once per page load.
      Global listeners (window, document) are registered HERE, never in render,
      or every re-render stacks another copy. app.js removes every ctx.on listener
      when the mode is deactivated, which is why init runs again on the way back in.
   3. render(ctx) is idempotent and rebuilds from ctx.state. It writes only inside
      ctx.outlet. It is called many times in a row and never diffs by hand.
   4. Never touch location.hash, localStorage or fetch. Use ctx.go, ctx.setState, ctx.data.
   5. Never hand-build a card, chip, meter, banner or empty state. Call ctx.ui.

   Because render() gets a fresh ctx each time but init() only ever sees the first one,
   the latest ctx is stashed in `cur` and global handlers read from that. */

(function () {
  'use strict';

  var cur = null;          /* latest ctx, refreshed on every render */
  var nodes = {};          /* DOM handles the view toggle needs after render */

  var COMMITTEE_RE = /committee|senator|parliamentarian|order paper|clerk|\bmp\b|caucus/i;

  function effectiveView(view) {
    var wide = false;
    try { wide = window.matchMedia('(min-width: 1000px)').matches; } catch (e) {}
    if (view === 'both' && !wide) return 'process';
    return view;
  }

  /* v1 writes aria-pressed from the stored view, so under 1000px nothing reads as
     pressed when "both" falls back. The tool writes it from the effective view. */
  function applyView() {
    if (!nodes.panes) return;
    var v = effectiveView(cur.state.view);
    nodes.segButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v));
    });
    nodes.panes.classList.toggle('both', v === 'both');
    nodes.paneProcess.hidden = !(v === 'process' || v === 'both');
    nodes.paneInfluence.hidden = !(v === 'influence' || v === 'both');
  }

  function disciplineRecord(ctx) {
    if (!ctx.state.discipline || !ctx.data.disciplineById) return null;
    return ctx.data.disciplineById.get(ctx.state.discipline) || null;
  }

  function bestEntry(disc, policyStage) {
    if (!disc || !disc.best_stages) return null;
    for (var i = 0; i < disc.best_stages.length; i++) {
      if (disc.best_stages[i].policyStage === policyStage) {
        return { entry: disc.best_stages[i], rank: i };
      }
    }
    return null;
  }

  /* ---------- track ---------- */

  function renderTrack(ctx) {
    var el = ctx.ui.el;
    var disc = disciplineRecord(ctx);
    var host = el('nav', 'track-wrap');
    host.setAttribute('aria-label', 'Policy stages');
    var w = el('div', 'wrap');
    var track = el('div', 'track');

    ctx.data.stages.stages.forEach(function (st) {
      var b = el('button', 'stage-btn');
      b.type = 'button';
      b.setAttribute('data-stage', String(st.id));
      b.setAttribute('aria-pressed', String(st.id === ctx.state.policyStage));
      var best = bestEntry(disc, st.id);
      b.setAttribute('aria-label',
        'Policy stage ' + st.id + ': ' + st.short + '.'
        + (best ? (best.rank === 0 ? ' Your opening in ' + disc.name + '.' : ' Also open for ' + disc.name + '.') : ''));

      b.appendChild(el('span', 'num', 'POLICY STAGE ' + st.id));
      b.appendChild(el('span', 'name', st.short));
      b.appendChild(el('span', 'line', st.line));
      b.appendChild(ctx.ui.meter(st.openness));
      b.appendChild(el('span', 'meter-label', st.openLabel));
      if (best) {
        b.appendChild(el('span',
          'pt-openflag ' + (best.rank === 0 ? 'pt-openflag--best' : 'pt-openflag--also'),
          best.rank === 0 ? 'Your opening' : 'Also open'));
      }
      b.addEventListener('click', function () { ctx.setState({ policyStage: st.id }); });
      track.appendChild(b);
    });

    w.appendChild(track);
    host.appendChild(w);
    nodes.track = track;
    return host;
  }

  /* ---------- actors ---------- */

  function renderActors(ctx, disc) {
    var el = ctx.ui.el;
    var box = el('section', 'pt-actors');
    box.appendChild(el('h3', null, 'Who you are dealing with'));
    var grid = el('div', 'pt-actors__grid');
    var cols = [
      ['decision_makers', 'Decision makers', 'pt-actors__col--decision'],
      ['influencers', 'Influencers', 'pt-actors__col--influencers'],
      ['implementers', 'Implementers', 'pt-actors__col--implementers']
    ];
    var actors = disc.actors || {};
    cols.forEach(function (c) {
      var col = el('div', 'pt-actors__col ' + c[2]);
      col.appendChild(el('h4', null, c[1]));
      var items = actors[c[0]] || [];
      if (items.length) {
        var ul = el('ul');
        items.forEach(function (x) { ul.appendChild(el('li', null, x)); });
        col.appendChild(ul);
      } else {
        var p = el('p', 'pt-actors__none', 'Not mapped yet for this field. ');
        p.appendChild(ctx.ui.chip(null, 'check'));
        col.appendChild(p);
      }
      grid.appendChild(col);
    });
    box.appendChild(grid);
    if (disc.influencers && disc.influencers.length) {
      box.appendChild(el('p', 'pt-actors__carriers', 'Carriers: ' + disc.influencers.join(', ') + '.'));
    }
    return box;
  }

  /* ---------- panes ---------- */

  function renderProcessPane(ctx, st) {
    var el = ctx.ui.el;
    var pane = el('section', 'pane process');
    pane.id = 'pt-pane-process';
    pane.setAttribute('aria-label', 'The machine');
    pane.appendChild(el('h3', 'pane-title', 'The machine'));
    pane.appendChild(el('p', 'lead', st.process.lead));

    /* These strings arrive as HTML from data/stages.json, a file this repo owns. */
    [['What happens', st.process.what], ['Who is in the room', st.process.who],
     ['What it produces', st.process.produces], ['How long', st.process.duration]
    ].forEach(function (pair) {
      var sec = el('div', 'sec');
      sec.appendChild(el('h4', null, pair[0]));
      var body = el('div');
      body.innerHTML = pair[1];
      sec.appendChild(body);
      pane.appendChild(sec);
    });

    var sig = el('div', 'sec');
    sig.appendChild(el('h4', null, 'How you can tell'));
    var sigBody = el('div');
    var ul = el('ul', 'signals');
    st.process.signals.forEach(function (s) {
      var li = el('li');
      li.innerHTML = s;
      ul.appendChild(li);
    });
    sigBody.appendChild(ul);
    sig.appendChild(sigBody);
    pane.appendChild(sig);
    return pane;
  }

  function sortedRoutes(st, disc) {
    var weights = (disc && disc.route_weights) || {};
    return st.influence.routes.map(function (r, i) {
      var w = weights[r.name];
      return { route: r, order: i, weight: (typeof w === 'number' ? w : null) };
    }).sort(function (a, b) {
      var aw = a.weight === null ? 1 : a.weight;
      var bw = b.weight === null ? 1 : b.weight;
      if (aw !== bw) return bw - aw;
      return a.order - b.order;
    });
  }

  function renderInfluencePane(ctx, st, disc) {
    var el = ctx.ui.el;
    var pane = el('section', 'pane influence');
    pane.id = 'pt-pane-influence';
    pane.setAttribute('aria-label', 'Your opening');
    pane.appendChild(el('h3', 'pane-title', 'Your opening'));

    var verdict = el('div', 'verdict');
    var left = el('div');
    left.appendChild(ctx.ui.meter(st.openness, { big: true }));
    left.appendChild(el('div', 'open-label', String(st.openLabel).toUpperCase()));
    verdict.appendChild(left);
    verdict.appendChild(el('p', 'say', st.influence.say));
    pane.appendChild(verdict);

    /* v1 makes this a <p>, which skips h4 between the pane's h3 and each route's h5. */
    var label = el('h4', 'routes-label');
    label.appendChild(el('span', null, 'Routes'));
    label.appendChild(el('span', null, disc ? 'Ranked for ' + disc.name : 'Ranked by leverage'));
    pane.appendChild(label);

    if (!disc) {
      pane.appendChild(el('p', 'pt-route-hint', 'Pick a field to re-rank these routes.'));
    }

    var ol = el('ol', 'routes');
    sortedRoutes(st, disc).forEach(function (item) {
      var r = item.route;
      var li = el('li', 'route');

      var h5 = el('h5', null, r.name);
      if (disc) {
        var wv = item.weight === null ? 1 : item.weight;
        var wrap = el('span', 'pt-weight');
        wrap.appendChild(ctx.ui.meter(wv, { of: 3, copper: true }));
        wrap.appendChild(el('span', 'pt-weight__label', 'Weight ' + wv + ' of 3'));
        wrap.appendChild(el('span', 'pt-sr', 'Weight ' + wv + ' of 3 for ' + disc.name));
        if (item.weight === null) wrap.appendChild(ctx.ui.chip(null, 'check'));
        h5.appendChild(wrap);
      }
      li.appendChild(h5);

      li.appendChild(el('p', 'oneliner', r.line));
      var dl = el('dl', 'kv');
      dl.appendChild(el('dt', null, 'You need'));
      dl.appendChild(el('dd', null, r.need));
      dl.appendChild(el('dt', null, 'Timing'));
      dl.appendChild(el('dd', null, r.timing));
      li.appendChild(dl);

      var det = el('details', 'rules');
      det.appendChild(el('summary', null, 'The rules and the links'));
      var rules = el('ul');
      (r.rules || []).forEach(function (x) {
        var rli = el('li');
        rli.innerHTML = x;
        rules.appendChild(rli);
      });
      det.appendChild(rules);
      li.appendChild(det);
      ol.appendChild(li);
    });
    pane.appendChild(ol);

    var sit = renderSitting(ctx, st);
    if (sit) pane.appendChild(sit);

    var assets = el('div', 'assets');
    assets.appendChild(el('h4', null, 'Have in hand'));
    var aul = el('ul');
    st.influence.assets.forEach(function (a) { aul.appendChild(el('li', null, a)); });
    assets.appendChild(aul);
    pane.appendChild(assets);

    var mistake = el('div', 'mistake');
    mistake.appendChild(el('h4', null, 'The mistake people make'));
    mistake.appendChild(el('p', null, st.influence.mistake));
    pane.appendChild(mistake);

    var cross = el('div', 'pt-walk__cross');
    cross.appendChild(ctx.ui.button('See what is open at this policy stage', {
      variant: 'copper',
      onClick: function () {
        ctx.go('#/openings?stage=' + st.id + (ctx.state.discipline ? '&d=' + encodeURIComponent(ctx.state.discipline) : ''));
      }
    }));
    pane.appendChild(cross);
    return pane;
  }

  /* ---------- sitting indicator ---------- */

  function stageNeedsSitting(st) {
    if (COMMITTEE_RE.test(st.influence.say)) return true;
    return st.influence.routes.some(function (r) {
      return COMMITTEE_RE.test(r.name) || COMMITTEE_RE.test(r.line) || COMMITTEE_RE.test(r.timing);
    });
  }

  function renderSitting(ctx, st) {
    if (!stageNeedsSitting(st)) return null;
    return ctx.ui.sittingLine();
  }

  /* ---------- controls ---------- */

  function renderControls(ctx, st) {
    var el = ctx.ui.el;
    var controls = el('div', 'controls');

    var seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'View');
    nodes.segButtons = [];
    [['process', 'The machine'], ['influence', 'Your opening'], ['both', 'Both']].forEach(function (v) {
      var b = el('button');
      b.type = 'button';
      b.setAttribute('data-view', v[0]);
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(el('span', 'dot'));
      b.appendChild(document.createTextNode(v[1]));
      b.addEventListener('click', function () { ctx.setState({ view: v[0] }); });
      seg.appendChild(b);
      nodes.segButtons.push(b);
    });
    controls.appendChild(seg);

    var pager = el('div', 'pager');
    var stages = ctx.data.stages.stages;
    var prev = el('button', null, st.id === 1 ? '← Previous stage' : '← ' + stages[st.id - 2].short);
    prev.type = 'button';
    prev.disabled = st.id === 1;
    prev.addEventListener('click', function () { ctx.setState({ policyStage: st.id - 1 }); });
    var next = el('button', null, st.id === 6 ? 'Next stage →' : stages[st.id].short + ' →');
    next.type = 'button';
    next.disabled = st.id === 6;
    next.addEventListener('click', function () { ctx.setState({ policyStage: st.id + 1 }); });
    pager.appendChild(prev);
    pager.appendChild(next);
    controls.appendChild(pager);
    return controls;
  }

  /* ---------- the mode ---------- */

  window.PolicyTool.modes.walk = {

    init: function (ctx) {
      /* Global listeners live here. Registered on each activation, torn down by
         app.js on each deactivation, so they never stack and never go stale. */
      ctx.on(window, 'resize', function () { applyView(); });

      ctx.on(document, 'keydown', function (e) {
        if (!cur || cur.state.mode !== 'walk') return;
        var t = e.target;
        if (t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'ArrowRight' && cur.state.policyStage < 6) {
          e.preventDefault();
          cur.setState({ policyStage: cur.state.policyStage + 1 });
        }
        if (e.key === 'ArrowLeft' && cur.state.policyStage > 1) {
          e.preventDefault();
          cur.setState({ policyStage: cur.state.policyStage - 1 });
        }
      });
    },

    render: function (ctx) {
      cur = ctx;
      nodes = {};
      var el = ctx.ui.el;
      var st = ctx.data.stageById.get(ctx.state.policyStage);
      if (!st) {
        ctx.outlet.appendChild(ctx.ui.wrap(ctx.ui.empty({
          title: 'That policy stage does not exist.',
          body: 'There are six. Start at the first one.',
          actionLabel: 'Policy stage 1',
          onAction: function () { ctx.setState({ policyStage: 1 }); }
        })));
        return;
      }
      var disc = disciplineRecord(ctx);

      if (!disc) {
        var hint = ctx.ui.wrap(el('p', 'pt-walk__hint', 'Pick a field to see where your opening is.'));
        ctx.outlet.appendChild(hint);
      }
      ctx.outlet.appendChild(renderTrack(ctx));

      var main = el('div', 'stage');
      var w = el('div', 'wrap');

      var head = el('div', 'stage-head');
      head.appendChild(el('span', 'eyebrow', 'Policy stage ' + st.id + ' of 6'));
      var h2 = el('h2', null, st.name);
      h2.tabIndex = -1;
      head.appendChild(h2);
      head.appendChild(el('p', 'tag', st.tag));
      w.appendChild(head);

      var best = bestEntry(disc, st.id);
      if (best) {
        /* The heading has to agree with the flag on the track button above it.
           Rank 0 is "Your opening", anything below that is "Also open". */
        var note = el('div', 'pt-opennote');
        note.appendChild(el('h3', null,
          (best.rank === 0 ? 'Your opening in ' : 'Also open in ') + disc.name));
        note.appendChild(el('p', null, best.entry.why));
        note.appendChild(ctx.ui.chip(null, disc.confidence === 'verified' ? 'verified' : 'check'));
        w.appendChild(note);
      }

      if (disc) w.appendChild(renderActors(ctx, disc));

      w.appendChild(renderControls(ctx, st));

      var panes = el('div', 'panes');
      panes.id = 'pt-panes';
      var paneP = renderProcessPane(ctx, st);
      var paneI = renderInfluencePane(ctx, st, disc);
      panes.appendChild(paneP);
      panes.appendChild(paneI);
      w.appendChild(panes);

      nodes.panes = panes;
      nodes.paneProcess = paneP;
      nodes.paneInfluence = paneI;

      main.appendChild(w);
      ctx.outlet.appendChild(main);

      applyView();

      var active = nodes.track && nodes.track.querySelector('.stage-btn[aria-pressed="true"]');
      if (active && active.scrollIntoView) {
        var narrow = false;
        try { narrow = window.matchMedia('(max-width: 699px)').matches; } catch (e) {}
        active.scrollIntoView({ block: 'nearest', inline: narrow ? 'center' : 'nearest' });
      }
    },

    destroy: function () {
      cur = null;
      nodes = {};
    }
  };
})();
