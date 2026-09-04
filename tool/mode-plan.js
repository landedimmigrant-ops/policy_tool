/* Mode C: Plan it.
   tool/mode-plan.js. Owner: Sonnet UI. Built to docs/design-spec.md 3.14, 3.15, 4.6.
   Follows tool/mode-walk.js's five rules exactly.

   One thing this file adds beyond mode-walk's patterns, worth explaining once here
   rather than at every call site. Every plan:change this mode causes itself (typing
   in a textarea, ticking an artefact box) would otherwise, on its own emit, tear the
   whole outlet down and rebuild it, which for a textarea means losing focus and the
   cursor mid-sentence. skipNextRender is set immediately before a call that would
   only restate what is already on screen (a debounced autosave, a checkbox whose own
   checked state the browser already shows), and the plan:change listener consumes
   the flag instead of re-rendering. Actions that change the shape of the page, such
   as adding or removing a row, do not set it, so the listener rebuilds normally.
   Nothing here reads or writes location.hash or localStorage directly; every mutation
   goes through ctx.plan, and a forced refresh goes through ctx.setState({}), which is
   an explicit no-op patch that still runs app.js's own render pipeline. */

(function () {
  'use strict';

  var cur = null;
  var hasRendered = false;

  var skipNextRender = false;
  var openingsById = {};

  var MACHINE_KINDS = ['consultation', 'bill', 'gazette', 'tender'];

  /* Verbatim from tools/impact-planning-intake.md, quoted in full in spec 3.14.
     app.js's plan.target shape names the seven fields change, changes, waiting,
     reach, forcing, offtable and gov without saying which question each answers;
     mapped here by the closest single word in each field name to the closest
     single word in each question, so every field is used exactly once. */
  var TARGET_QUESTIONS = [
    { field: 'change', text: 'Who is different because of this work, beyond other researchers?' },
    { field: 'changes', text: 'What changes for them? Be concrete.' },
    { field: 'waiting', text: 'Who is already waiting for this?' },
    { field: 'reach', text: 'Who outside academia are you in contact with about this?' },
    { field: 'forcing', text: 'What is forcing this now?' },
    { field: 'offtable', text: 'Anything off the table? Sensitivities, community protocols, confidentiality.' }
  ];

  /* Spec 3.14. Every derived date carries a Check chip; Brief due is the one row
     that is not derived, so it carries whatever chip the record itself would. */
  var PLAN_OFFSETS = [
    { key: 'contact', label: 'Contact', copy: 'Email the clerk or the director general' },
    { key: 'draft', label: 'Draft done', copy: 'Your draft finished' },
    { key: 'translation', label: 'Translation starts', copy: 'One business day per 2,000 words. Senate rule, applied to both chambers' },
    { key: 'brief', label: 'Brief due', copy: 'The deadline itself' }
  ];

  /* ---------- date helpers ---------- */

  function isoOf(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function parseIso(iso) {
    var m = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function subtractBusinessDays(iso, n) {
    var d = parseIso(iso);
    if (!d) return null;
    var remaining = n;
    while (remaining > 0) {
      d.setDate(d.getDate() - 1);
      var day = d.getDay();
      if (day !== 0 && day !== 6) remaining--;
    }
    return isoOf(d);
  }
  function todayIso() { return isoOf(new Date()); }

  function inheritedChipKind(ctx, record) {
    if (!record) return 'check';
    if (MACHINE_KINDS.indexOf(record.source_kind) > -1 && record._tier !== 3) return 'verified';
    var d = ctx.format.daysUntil(record.verified_on);
    if (d !== null && d > -90) return 'verified';
    return 'check';
  }

  /* ---------- small helpers ---------- */

  function buildOpeningsIndex(ctx) {
    var map = {};
    (ctx.data.openings || []).forEach(function (r) { map[r.id] = r; });
    return map;
  }

  function planIsEmpty(plan) {
    if (plan.openings.length || plan.contactsLog.length) return false;
    var t = plan.target;
    return !(t.change || t.changes || t.waiting || t.reach || t.forcing || t.offtable || t.gov);
  }

  /* Debounced per field so two fields being typed into at once do not cancel each
     other's timers, and guarded so the resulting plan:change does not rebuild the
     very field the reader is still typing into. skipRerender defaults to true: a
     target answer or a contact's notes have no effect on the rest of the page, so
     there is nothing to gain by rebuilding. The one field passed false is the words
     input on an opening row, because it feeds the dates section's translation-start
     row on this same screen, which does need to refresh once the reader finishes
     typing a number. */
  var pendingSaves = [];

  function makeAutosave(path, skipRerender) {
    if (skipRerender === undefined) skipRerender = true;
    var t = null;
    function save(value) {
      if (t) clearTimeout(t);
      if (pendingSaves.indexOf(save) === -1) pendingSaves.push(save);
      t = setTimeout(function () {
        t = null;
        var i = pendingSaves.indexOf(save);
        if (i > -1) pendingSaves.splice(i, 1);
        if (skipRerender) skipNextRender = true;
        cur.plan.setField(path, value);
      }, 400);
    }
    save.cancel = function () {
      if (t) { clearTimeout(t); t = null; }
      var i = pendingSaves.indexOf(save);
      if (i > -1) pendingSaves.splice(i, 1);
    };
    return save;
  }

  /* Contact paths are positional (contactsLog.2.notes), so any change that
     renumbers the list has to land on an empty queue. */
  function cancelPendingSaves() {
    pendingSaves.slice().forEach(function (save) { save.cancel(); });
    pendingSaves = [];
  }

  /* app.js captures and restores focus by element id around every renderActive(),
     so the words input keeps focus and its caret across a rebuild. */
  function forceRefresh() {
    if (cur) cur.setState({});
  }

  function onPlanChange() {
    if (skipNextRender) { skipNextRender = false; return; }
    if (!cur || cur.state.mode !== 'plan' || !hasRendered) return;
    forceRefresh();
  }

  /* ---------- clipboard and file export, 3.15 ---------- */

  function flipLabel(btn, text, ms) {
    var original = btn.textContent;
    btn.textContent = text;
    setTimeout(function () { if (btn) btn.textContent = original; }, ms);
  }

  function copyText(text, onOk, onFail) {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') { onFail(); return; }
      navigator.clipboard.writeText(text).then(onOk, onFail);
    } catch (e) { onFail(); }
  }

  function downloadJson(plan) {
    try {
      var json = JSON.stringify(plan, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'policy-plan-' + todayIso() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    } catch (e) {}
  }

  function planToMarkdown(ctx, plan) {
    var lines = [];
    lines.push('# Your federal policy plan');
    lines.push('');
    lines.push('## What');
    TARGET_QUESTIONS.forEach(function (q) {
      lines.push('**' + q.text + '**');
      lines.push('');
      lines.push(plan.target[q.field] || '(not answered)');
      lines.push('');
    });
    lines.push("**The government's own words you attach to.**");
    lines.push('');
    lines.push(plan.target.gov || '(not answered)');
    lines.push('');
    lines.push('## So what');
    if (!plan.openings.length) {
      lines.push('No openings added yet.');
    } else {
      plan.openings.forEach(function (o) {
        var r = openingsById[o.id];
        if (!r) { lines.push('- This opening is no longer in the data. Saved id: ' + o.id); return; }
        lines.push('- [' + r.title + '](' + r.source_url + '), policy stage ' + r.policyStage + ', ' + ctx.ui.closesLabel(r));
      });
    }
    lines.push('');
    lines.push('## Now what');
    lines.push('');
    lines.push('### Have in hand');
    var groups = artefactGroups(ctx, plan);
    if (!groups.length) {
      lines.push('The artefact list builds from the policy stages of the openings you add.');
    } else {
      groups.forEach(function (g) {
        g.items.forEach(function (item) {
          var checked = plan.artefacts.indexOf(item.key) > -1;
          lines.push('- [' + (checked ? 'x' : ' ') + '] ' + item.text + ' (' + item.time.label + ')');
        });
      });
    }
    lines.push('');
    lines.push('### Dates');
    var blocks = dateBlocks(ctx, plan);
    if (!blocks.length) {
      lines.push('Dates appear once an opening with a close date is in the plan.');
    } else {
      blocks.forEach(function (b) {
        lines.push('**' + b.title + '**');
        b.rows.forEach(function (row) {
          lines.push('- ' + row.label + ': ' + (row.date ? ctx.format.dateLabel(row.date) + (row.passed ? ' (passed)' : '') : 'not yet computed'));
        });
        lines.push('');
      });
    }
    lines.push('### Contacts');
    if (!plan.contactsLog.length) {
      lines.push('No contacts logged yet.');
    } else {
      plan.contactsLog.forEach(function (c) {
        var parts = [c.name || '(no name)'];
        if (c.role) parts.push(c.role);
        parts.push('met ' + (c.met || 'unknown'));
        if (c.notes) parts.push(c.notes);
        if (c.next) parts.push('next: ' + c.next);
        lines.push('- ' + parts.join(', ') + '.');
      });
    }
    lines.push('');
    return lines.join('\n');
  }

  /* ---------- artefacts, 3.14 ---------- */

  function artefactGroups(ctx, plan) {
    var stageNums = {};
    plan.openings.forEach(function (o) {
      var r = openingsById[o.id];
      if (r) stageNums[r.policyStage] = true;
    });
    if (plan.discipline) {
      var disc = ctx.data.disciplineById && ctx.data.disciplineById.get(plan.discipline);
      if (disc && disc.best_stages && disc.best_stages.length) stageNums[disc.best_stages[0].policyStage] = true;
    }
    var nums = Object.keys(stageNums).map(Number).sort(function (a, b) { return a - b; });
    return nums.map(function (n) {
      var st = ctx.data.stageById.get(n);
      if (!st) return null;
      var items = (st.influence.assets || []).map(function (text, i) {
        return { key: 's' + n + '-a' + i, text: text, time: ctx.artefactTime(text) };
      });
      return { stage: st, items: items };
    }).filter(Boolean);
  }

  function renderArtefactsSection(ctx, plan, ro) {
    var el = ctx.ui.el;
    var section = el('section', 'pt-plan__section');
    section.id = 'pt-plan-artefacts';
    section.appendChild(el('h3', null, 'Have in hand'));
    var groups = artefactGroups(ctx, plan);
    if (!groups.length) {
      section.appendChild(el('p', 'pt-plan__section-note', 'The artefact list builds from the policy stages of the openings you add.'));
      return section;
    }
    groups.forEach(function (g) {
      var box = el('div', 'pt-plan__artefact-group');
      box.appendChild(el('h4', null, 'Policy stage ' + g.stage.id + ', ' + g.stage.short));
      var ul = el('ul', 'pt-plan__artefacts');
      g.items.forEach(function (item) {
        var li = el('li', 'pt-plan__artefact');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'pt-plan-artefact-' + item.key;
        cb.checked = plan.artefacts.indexOf(item.key) > -1;
        cb.disabled = ro;
        cb.addEventListener('change', function () {
          skipNextRender = true;
          cur.plan.toggleArtefact(item.key);
        });
        li.appendChild(cb);
        var textBox = el('span', 'pt-plan__artefact-text');
        var label = document.createElement('label');
        label.setAttribute('for', cb.id);
        label.textContent = item.text;
        textBox.appendChild(label);
        var time = el('span', 'pt-plan__artefact-time');
        time.appendChild(document.createTextNode(item.time.label + ' '));
        time.appendChild(ctx.ui.chip(null, 'check'));
        textBox.appendChild(time);
        li.appendChild(textBox);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      section.appendChild(box);
    });
    return section;
  }

  /* ---------- dates, 3.14 ---------- */

  function dateBlocks(ctx, plan) {
    var out = [];
    plan.openings.forEach(function (o) {
      var r = openingsById[o.id];
      if (!r || !r.closes) return;
      var words = (plan.words || {})[r.id];
      var rows = [];
      PLAN_OFFSETS.forEach(function (offset) {
        var date = null;
        var note = null;
        if (offset.key === 'contact') date = ctx.format.addDays(r.closes, -21);
        else if (offset.key === 'draft') date = ctx.format.addDays(r.closes, -14);
        else if (offset.key === 'translation') {
          if (words && +words > 0) date = subtractBusinessDays(r.closes, Math.ceil((+words) / 2000));
          else note = 'Add a word count above to compute this date.';
        } else if (offset.key === 'brief') date = r.closes;
        var daysOut = date ? ctx.format.daysUntil(date) : null;
        var passed = daysOut !== null && daysOut < 0;
        rows.push({
          label: offset.label, copy: offset.copy, date: date, note: note, passed: passed,
          chipKind: offset.key === 'brief' ? inheritedChipKind(ctx, r) : 'check'
        });
      });
      out.push({ title: r.title, rows: rows });
    });
    return out;
  }

  function renderDatesSection(ctx, plan) {
    var el = ctx.ui.el;
    var section = el('section', 'pt-plan__section');
    section.id = 'pt-plan-dates';
    section.appendChild(el('h3', null, 'Dates'));
    var blocks = dateBlocks(ctx, plan);
    if (!blocks.length) {
      section.appendChild(el('p', 'pt-plan__section-note', 'Dates appear once an opening with a close date is in the plan.'));
      return section;
    }
    blocks.forEach(function (b) {
      var block = el('div', 'pt-plan__dates-block');
      block.appendChild(el('h4', null, b.title));
      var ul = el('ul', 'pt-plan__dates-table');
      b.rows.forEach(function (row) {
        var li = el('li', 'pt-plan__dates-row');
        li.appendChild(el('span', 'pt-plan__dates-row__label', row.label));
        var dateSpan = el('span', 'pt-plan__dates-row__date' + (row.passed ? ' pt-plan__date--passed' : ''));
        if (row.date) {
          dateSpan.appendChild(document.createTextNode(ctx.format.dateLabel(row.date) + (row.passed ? ' Passed' : '')));
          dateSpan.appendChild(ctx.ui.chip(null, row.chipKind));
        } else {
          dateSpan.appendChild(document.createTextNode(row.note || ''));
          dateSpan.className += ' pt-plan__dates-row__note';
        }
        li.appendChild(dateSpan);
        li.appendChild(el('span', 'pt-plan__dates-row__copy', row.copy));
        ul.appendChild(li);
      });
      block.appendChild(ul);
      section.appendChild(block);
    });
    return section;
  }

  /* ---------- target, 3.14 ---------- */

  function renderTargetSection(ctx, plan, ro) {
    var el = ctx.ui.el;
    var section = el('section', 'pt-plan__section');
    section.id = 'pt-plan-target';
    section.appendChild(el('h3', null, 'Your target'));

    var disc = plan.discipline && ctx.data.disciplineById ? ctx.data.disciplineById.get(plan.discipline) : null;
    var fieldLine = el('p', 'pt-plan__field-line');
    fieldLine.appendChild(document.createTextNode('Field: '));
    fieldLine.appendChild(el('b', null, disc ? disc.name : 'Not set yet'));
    section.appendChild(fieldLine);

    TARGET_QUESTIONS.forEach(function (q) {
      var ta = document.createElement('textarea');
      ta.id = 'pt-plan-target-' + q.field;
      ta.value = plan.target[q.field] || '';
      ta.readOnly = ro;
      var save = makeAutosave('target.' + q.field);
      ta.addEventListener('input', function () { save(ta.value); });
      section.appendChild(ctx.ui.field(q.text, ta));
    });

    section.appendChild(el('h4', null, "The government's own words you attach to"));
    section.appendChild(el('p', 'pt-plan__section-note', 'A mandate letter line, a budget line, a throne speech sentence. Quote it.'));
    var gov = document.createElement('textarea');
    gov.id = 'pt-plan-target-gov';
    gov.value = plan.target.gov || '';
    gov.readOnly = ro;
    var saveGov = makeAutosave('target.gov');
    gov.addEventListener('input', function () { saveGov(gov.value); });
    section.appendChild(ctx.ui.field('The quote', gov));

    return section;
  }

  /* ---------- openings, 3.14 ---------- */

  function renderOpeningsSection(ctx, plan, ro) {
    var el = ctx.ui.el;
    var section = el('section', 'pt-plan__section');
    section.id = 'pt-plan-openings';
    section.appendChild(el('h3', null, 'Openings you are working'));

    if (!plan.openings.length) {
      section.appendChild(ctx.ui.empty({
        title: 'No openings added yet.',
        body: 'The board is where you pick them.',
        actionLabel: 'Go to Openings',
        onAction: function () { ctx.go('#/openings'); }
      }));
      return section;
    }

    plan.openings.forEach(function (o) {
      var r = openingsById[o.id];
      var row = el('div', 'pt-plan__row' + (r ? '' : ' pt-plan__row--orphan'));
      if (!r) {
        row.appendChild(el('p', 'pt-plan__row-title',
          'This opening is no longer in the data. It may have closed. Saved id: ' + o.id));
        if (!ro) {
          var removeOnly = ctx.ui.button('Remove', { variant: 'ghost', onClick: function () { cancelPendingSaves(); cur.plan.remove(o.id); } });
          row.appendChild(removeOnly);
        }
        section.appendChild(row);
        return;
      }

      var h4 = el('h4', 'pt-plan__row-title');
      var titleLink = el('a', null, r.title);
      titleLink.href = r.source_url;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener';
      h4.appendChild(titleLink);
      row.appendChild(h4);

      var meta = el('p', 'pt-plan__row-meta');
      meta.appendChild(document.createTextNode(ctx.ui.closesLabel(r)));
      row.appendChild(meta);

      var links = el('div', 'pt-plan__row-links');
      links.appendChild(ctx.ui.stageChip(r.policyStage, { link: false }));
      links.appendChild(ctx.ui.button('Where this sits', {
        variant: 'ghost',
        onClick: function () {
          ctx.go('#/walk/s' + r.policyStage + '-influence' + (ctx.state.discipline ? '?d=' + encodeURIComponent(ctx.state.discipline) : ''));
        }
      }));
      row.appendChild(links);

      var foot = el('div', 'pt-plan__row-foot');
      var words = document.createElement('input');
      words.type = 'number';
      words.min = '0';
      words.step = '1';
      words.id = 'pt-plan-words-' + r.id;
      var storedWords = (plan.words || {})[r.id];
      words.value = storedWords ? String(storedWords) : '';
      words.readOnly = ro;
      words.disabled = ro;
      var saveWords = makeAutosave('words.' + r.id, false);
      words.addEventListener('input', function () {
        var n = parseInt(words.value, 10);
        saveWords(isNaN(n) || n < 0 ? 0 : n);
      });
      foot.appendChild(ctx.ui.field('Words, for the translation buffer', words));
      if (!ro) {
        foot.appendChild(ctx.ui.button('Remove', { variant: 'ghost', onClick: function () { cancelPendingSaves(); cur.plan.remove(r.id); } }));
      }
      row.appendChild(foot);

      section.appendChild(row);
    });

    return section;
  }

  /* ---------- contacts, 3.14 ---------- */

  function renderContactsSection(ctx, plan, ro) {
    var el = ctx.ui.el;
    var section = el('section', 'pt-plan__section');
    section.id = 'pt-plan-contacts';
    section.appendChild(el('h3', null, 'Contacts'));

    var ul = el('ul', 'pt-plan__contacts');
    plan.contactsLog.forEach(function (c, i) {
      var li = el('li', 'pt-plan__contact');
      var fields = [
        ['name', 'Name', 'text'],
        ['role', 'Role and body', 'text'],
        ['met', 'Date met', 'date'],
        ['notes', 'Notes', 'text'],
        ['next', 'Next touch', 'text']
      ];
      fields.forEach(function (f) {
        var input = document.createElement('input');
        input.type = f[2];
        input.id = 'pt-contact-' + i + '-' + f[0];
        input.value = c[f[0]] || '';
        /* readOnly is unreliable on type="date" in some browsers, so lock every
           field in the row the same way rather than mixing readOnly and disabled
           within one row. */
        input.disabled = ro;
        var save = makeAutosave('contactsLog.' + i + '.' + f[0]);
        input.addEventListener('input', function () { save(input.value); });
        li.appendChild(ctx.ui.field(f[1], input));
      });
      if (!ro) {
        var actions = el('div', 'pt-plan__contact-actions');
        actions.appendChild(ctx.ui.button('Remove', { variant: 'ghost', onClick: function () { cancelPendingSaves(); cur.plan.removeContact(i); } }));
        li.appendChild(actions);
      }
      ul.appendChild(li);
    });
    section.appendChild(ul);

    if (!ro) {
      var add = ctx.ui.button('Add a contact', { variant: 'ghost', onClick: function () { cancelPendingSaves(); cur.plan.addContact(); } });
      var addWrap = el('div', 'pt-plan__contacts-add');
      addWrap.appendChild(add);
      section.appendChild(addWrap);
    }
    return section;
  }

  /* ---------- export, 3.15 ---------- */

  /* Export reads cur.plan.get() at click time, never the plan snapshot this section
     was built from. A text field's autosave is deliberately debounced and skips its
     own re-render (see the file header), so the render-time snapshot can be a beat
     behind the last keystroke even though app.js already has it saved. Reading live
     at the moment of the click is the only way "Copy share link" cannot ship a plan
     that is missing the answer someone just finished typing. */
  function renderExportSection(ctx, plan) {
    var el = ctx.ui.el;
    var section = el('section', 'pt-plan__section');
    section.id = 'pt-plan-export';
    section.appendChild(el('h3', null, 'Take it with you'));

    var actions = el('div', 'pt-plan__export-actions');

    actions.appendChild(ctx.ui.button('Print the brief', { onClick: function () { window.print(); } }));

    var mdBtn = ctx.ui.button('Copy as Markdown', {
      onClick: function () {
        copyText(planToMarkdown(ctx, cur.plan.get()), function () {
          flipLabel(mdBtn, 'Copied', 1500);
        }, function () {
          flipLabel(mdBtn, 'Copy unavailable', 1500);
          showClipboardWarning(section);
        });
      }
    });
    actions.appendChild(mdBtn);

    actions.appendChild(ctx.ui.button('Download JSON', { onClick: function () { downloadJson(cur.plan.get()); } }));

    /* The render-time check only decides which control to show first; a plan that
       crosses 8000 characters between renders (typing does not force one) is caught
       again inside the button's own click handler below. */
    var encoded = ctx.planShare.encode(plan);
    if (!encoded || encoded.length > 8000) {
      actions.appendChild(ctx.ui.banner('warn', 'This plan is too long to fit in a link. Download the JSON and send that instead.'));
    } else {
      var linkBtn = ctx.ui.button('Copy share link', {
        onClick: function () {
          var freshEncoded = ctx.planShare.encode(cur.plan.get());
          if (!freshEncoded || freshEncoded.length > 8000) {
            var warn = cur.ui.banner('warn', 'This plan is too long to fit in a link. Download the JSON and send that instead.');
            linkBtn.parentNode.replaceChild(warn, linkBtn);
            return;
          }
          var url = location.origin + location.pathname + '#/plan?p=' + freshEncoded;
          copyText(url, function () {
            flipLabel(linkBtn, 'Copied', 1500);
          }, function () {
            flipLabel(linkBtn, 'Copy unavailable', 1500);
            showClipboardWarning(section);
          });
        }
      });
      actions.appendChild(linkBtn);
    }

    section.appendChild(actions);
    section.appendChild(el('p', 'pt-plan__privacy',
      'Everything you type stays in this browser. A share link carries your plan text inside the link, so send it only to people you want reading it.'));
    return section;
  }

  function showClipboardWarning(section) {
    if (section.querySelector('.pt-plan__clipboard-warning')) return;
    var el = cur.ui.el;
    var p = el('p', 'pt-plan__section-note pt-plan__clipboard-warning', 'Your browser blocked the clipboard. Use Download instead.');
    section.appendChild(p);
  }

  /* ---------- print, 7.6 ---------- */

  function buildPrintContainer(ctx, plan) {
    var el = ctx.ui.el;
    var root = document.createElement('div');
    root.id = 'pt-print';
    root.className = 'pt-print';
    /* Hidden on screen by styles.css's .pt-print { display: none }, not by the
       hidden attribute, so print.css's display:block is not relying on author
       rules beating the UA sheet. Being display:none keeps it out of the
       accessibility tree, so the real headings below cost a screen reader
       nothing and give a printed or saved PDF an actual outline. h2, h3, h4
       after the visible sections descends, and descending never skips. */
    function heading(text) { return el('h3', 'pt-print__heading', text); }
    function label(text) { return el('h4', 'pt-print__label', text); }
    function body(text) { return el('p', 'pt-print__body', text || '(not answered)'); }
    function section(cls) { var s = el('section', 'pt-print__section ' + cls); return s; }

    root.appendChild(el('h2', 'pt-print__title', 'Your federal policy plan'));

    var what = section('pt-print__what');
    what.appendChild(heading('What'));
    TARGET_QUESTIONS.forEach(function (q) {
      what.appendChild(label(q.text));
      what.appendChild(body(plan.target[q.field]));
    });
    root.appendChild(what);

    var soWhat = section('pt-print__sowhat');
    soWhat.appendChild(heading('So what'));
    if (!plan.openings.length) {
      soWhat.appendChild(body(null));
    } else {
      plan.openings.forEach(function (o) {
        var r = openingsById[o.id];
        var line = el('p', 'pt-print__body');
        if (r) {
          line.appendChild(document.createTextNode(r.title + ', policy stage ' + r.policyStage + ', ' + ctx.ui.closesLabel(r) + ' '));
          /* A real <a href>, not text with the URL typed into it: print.css's
             a[href]:after rule is what puts the href in brackets, and a printed
             page saved to PDF keeps this as an actual, clickable link. */
          var link = el('a', null, '');
          link.href = r.source_url;
          line.appendChild(link);
        } else {
          line.textContent = 'This opening is no longer in the data. Saved id: ' + o.id;
        }
        soWhat.appendChild(line);
      });
    }
    soWhat.appendChild(label("The government's own words you attach to"));
    soWhat.appendChild(body(plan.target.gov));
    root.appendChild(soWhat);

    var nowWhat = section('pt-print__nowwhat');
    nowWhat.appendChild(heading('Now what'));
    nowWhat.appendChild(label('Have in hand'));
    var groups = artefactGroups(ctx, plan);
    if (!groups.length) {
      nowWhat.appendChild(body('The artefact list builds from the policy stages of the openings you add.'));
    } else {
      groups.forEach(function (g) {
        g.items.forEach(function (item) {
          var checked = plan.artefacts.indexOf(item.key) > -1;
          nowWhat.appendChild(body((checked ? 'In hand. ' : 'Still needed. ') + item.text));
        });
      });
    }
    nowWhat.appendChild(label('Dates'));
    var blocks = dateBlocks(ctx, plan);
    if (!blocks.length) {
      nowWhat.appendChild(body('Dates appear once an opening with a close date is in the plan.'));
    } else {
      blocks.forEach(function (b) {
        nowWhat.appendChild(body(b.title));
        b.rows.forEach(function (row) {
          var text = row.label + ': ' + (row.date ? ctx.format.dateLabel(row.date) + (row.passed ? ', passed' : '') : 'not yet computed');
          nowWhat.appendChild(el('p', 'pt-print__body pt-print__body--indent', text));
        });
      });
    }
    nowWhat.appendChild(label('Contacts'));
    if (!plan.contactsLog.length) {
      nowWhat.appendChild(body('No contacts logged yet.'));
    } else {
      plan.contactsLog.forEach(function (c) {
        nowWhat.appendChild(body((c.name || 'Unnamed contact') + ', ' + (c.role || 'role not noted') +
          '. Met ' + (c.met || 'date not noted') + '. ' + (c.notes || '') + (c.next ? ' Next: ' + c.next : '')));
      });
    }
    root.appendChild(nowWhat);

    return root;
  }

  /* ---------- the mode ---------- */

  window.PolicyTool.modes.plan = {

    init: function (ctx) {
      cur = ctx;
      ctx.bus.on('plan:change', onPlanChange);
    },

    render: function (ctx) {
      cur = ctx;
      var el = ctx.ui.el;
      var plan = ctx.state.plan;
      openingsById = buildOpeningsIndex(ctx);

      var page = el('div', 'pt-plan');
      var w = el('div', 'wrap');

      /* app.js owns pt-schema and decides both of these at load, spec 2.4. */
      var schemaTooNew = ctx.plan.schemaTooNew();
      var shared = ctx.plan.isShared();
      var ro = ctx.plan.isReadOnly();

      if (shared) {
        w.appendChild(ctx.ui.banner('info', 'You are reading a shared plan. Your own plan is untouched.', {
          actionLabel: 'Replace my plan with this one',
          onAction: function () { cancelPendingSaves(); cur.plan.replaceWith(cur.plan.get()); }
        }));
      } else if (schemaTooNew) {
        w.appendChild(ctx.ui.banner('warn', 'This plan was saved by a newer version of the tool. Download it before you change anything.'));
      }

      var h2 = el('h2', null, 'Plan it');
      h2.tabIndex = -1;
      w.appendChild(h2);

      if (planIsEmpty(plan)) {
        w.appendChild(ctx.ui.empty({
          title: 'Your plan is empty.',
          body: 'Add an opening from the Openings board, or start with the six questions below. Everything you type stays in this browser.',
          actionLabel: 'Go to Openings',
          onAction: function () { ctx.go('#/openings'); }
        }));
      }

      var sections = el('div', 'pt-plan__sections');
      sections.appendChild(renderTargetSection(ctx, plan, ro));
      sections.appendChild(renderOpeningsSection(ctx, plan, ro));
      sections.appendChild(renderArtefactsSection(ctx, plan, ro));
      sections.appendChild(renderDatesSection(ctx, plan));
      sections.appendChild(renderContactsSection(ctx, plan, ro));
      sections.appendChild(renderExportSection(ctx, plan));
      w.appendChild(sections);

      w.appendChild(buildPrintContainer(ctx, plan));

      page.appendChild(w);
      ctx.outlet.appendChild(page);

      hasRendered = true;
    },

    destroy: function () {
      cancelPendingSaves();
      window.PolicyTool.bus.off('plan:change', onPlanChange);
      cur = null;
      openingsById = {};
      hasRendered = false;
      skipNextRender = false;
    }
  };
})();
