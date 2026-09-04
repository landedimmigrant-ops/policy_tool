# Design spec: the prototype tool at `/tool/`

Owner: Opus UX. Approved at Gate 2 before any UI code is written.
Written for two readers: the director who approves it, and the engineer who builds Modes B and C from it plus the Mode A code.

Scope is the plan and nothing else. Three modes, two front doors, one spine of six policy stages. v1 at the repo root is untouched by this spec.

**Naming rule that governs the whole document.** The six government stages are "policy stage" in copy and `policyStage` in code. Nothing else in the tool is called a stage. Not the planner steps, not the mode tabs, not the front doors.

---

## 0. What carries over from v1

v1 (`/index.html`) is the visual parent. The tool copies its tokens and its component CSS rather than reinventing them, so the two pages read as one product.

Kept verbatim in `tool/styles.css`:

| Thing | Why it stays |
|---|---|
| The full `:root` token block, both `prefers-color-scheme` and `[data-theme]` overrides | Same family, both themes already solved |
| `--serif` Newsreader, `--sans` Public Sans, `--mono` IBM Plex Mono, same Google Fonts link | Type is half the identity |
| `.wrap`, `.masthead`, `.brand`, `.chip`, `.chip.accent` | Shell |
| `.track`, `.stage-btn`, `.meter`, `.meter i.on` | The spine, unchanged |
| `.seg` segmented view control with `aria-pressed` | Same control, same behaviour |
| `.pane`, `.pane-title`, `.lead`, `.sec`, `.tracks`, `.tracklet` | Mode A renders v1's stage content |
| `.verdict`, `.routes`, `.route`, `.kv`, `details.rules`, `.assets`, `.mistake` | Same |
| `.v` and `.v.check` Verified and Check chips | The trust mechanism, reused everywhere |
| `:focus-visible { outline: 2px solid var(--accent) }` | Keep |
| `@media (prefers-reduced-motion: reduce) { * { transition: none !important } }` | Keep and extend |

**The green and copper split is load-bearing and applies in every new component.** Green `--accent` is understanding: the machine, process content, links, the openness meter's label, neutral affirmatives. Copper `--copper` is action: your opening, routes, route weights, the how-to-intervene tip, close dates, Add to plan, everything in the planner that produces an artefact. A component never uses both for the same meaning.

Three deliberate corrections to v1, listed so the engineer does not copy the faults:

1. **Heading skip.** v1 goes `.sec h4` then `.route h5` with nothing between, because `.routes-label` is a `<p>`. In the tool `.routes-label` is an `<h4>` with identical styling. Section 6 sets the full hierarchy.
2. **View toggle under 1000px.** v1's `applyView()` writes `aria-pressed` from the stored view, so when `both` falls back to `process` on a narrow screen no button reads as pressed. The tool writes `aria-pressed` from the **effective** view.
3. **Copper contrast.** `--copper` #B0602B on `--surface` #F8F7F3 is 4.30:1, below AA for body text. One new token fixes it, see Appendix A.

---

## 1. Information architecture

### 1.1 The shell

`tool/index.html` is a static shell. Everything below the mode bar is rendered by JavaScript into one outlet.

```
<body>
  <a class="pt-skip" href="#pt-outlet">Skip to content</a>
  <header class="masthead pt-masthead">        app.js
  <div id="pt-modebar" class="pt-modebar">      app.js, three tabs
  <div id="pt-context" class="pt-contextbar">   app.js, hidden when empty
  <main id="pt-outlet" class="pt-outlet">       the active mode renders here
  <div id="pt-live" aria-live="polite" class="pt-sr">   announcements
  <footer class="pt-footer">                    app.js
```

The mode bar is always present, including on the front doors, so the tool never traps a first-time visitor in the doors.

### 1.2 The two front doors

Route `#/start`. Rendered by `app.js`, not by a mode file, because both doors feed Mode A and no mode owns them.

```
h2  What's your situation?
    Eight .pt-situation cards from data/situations.json, 4 across on desktop, 2 on tablet, 1 on mobile.
h2  What's your field?
    .pt-discipline-picker: one search input, then six <section> groups by CRDC division,
    23 .pt-discipline buttons in total, from data/disciplines.json.
```

Shown when: the hash is `#/start`, or the hash is empty and `pt-seen-doors` is not set. A returning visitor with `pt-seen-doors` set and no hash lands in their last mode instead, with a "Start over" link in the context bar back to `#/start`.

### 1.3 The three modes

| Mode | Route | File | Job |
|---|---|---|---|
| Walk it | `#/walk/s<N>-<view>` | `mode-walk.js` | The six policy stages read through one field: which stage is your opening, who your actors are, which routes rank first |
| Openings | `#/openings` | `mode-openings.js` | A filterable board of live federal opportunities, every card carrying an instruction |
| Plan it | `#/plan` | `mode-plan.js` | The saved, exportable engagement plan |

### 1.4 What carries between them

Four pieces of state survive a mode switch. Nothing else does.

| Carried | Set by | Read by |
|---|---|---|
| `discipline` (id or null) | Field door, discipline switcher in Walk it, discipline filter in Openings | Walk it (openings marker, actors, route weights), Openings (default domain filter), Plan it (recorded on the plan) |
| `policyStage` (1 to 6) | Situation card, stage track, Openings card "Go to policy stage" | Walk it (which stage), Openings (default policy stage filter, only when arriving from Walk it) |
| `view` (process, influence, both) | Situation card, segmented control | Walk it only. Persists so a return to Walk it keeps the reader's preference |
| `plan` (object) | Add to plan in Openings, every field in Plan it | Plan it renders it, Openings uses it to mark cards already added, the mode bar shows the count |

Filters are Mode B only and are not carried anywhere else. Search text is not persisted between sessions.

### 1.5 How the doors and modes connect

| From | Action | Lands on |
|---|---|---|
| Situation card | click | `record.route` when the record carries one, otherwise `#/walk/s{card.policyStage}-{card.view}`. Discipline untouched either way |
| Discipline button | click | `#/walk/s{best_stages[0].policyStage}-influence?d={id}` |
| Walk it, stage track | click a policy stage | same mode, new `policyStage` |
| Walk it, "See what is open at this policy stage" link under the routes list | click | `#/openings?stage={N}&d={discipline}` |
| Openings card, policy stage chip | click | `#/walk/s{N}-influence?d={discipline}` |
| Openings card, Add to plan | click | stays put, plan count on the Plan it tab increments |
| Plan it, an opening row | click the title | `#/openings?q={title}` is wrong and is not used. The row links to `source_url` in a new tab, and carries a second link "Where this sits" to `#/walk/s{N}-influence` |
| Context bar, discipline name | click | `#/start` with the field door scrolled into view |

There is exactly one cross-link in each direction between Walk it and Openings, and one from Plan it back to Walk it. No other cross-navigation exists.

---

## 2. URL and state

### 2.1 Hash grammar

v1 owns `#s<N>-<view>` at the repo root. The tool extends it with a leading mode segment so the two grammars never collide, and keeps v1's stage token verbatim so a reader recognizes it.

```
hash        := "#/" mode [ "/" stagetoken ] [ "?" query ]
mode        := "start" | "walk" | "openings" | "plan"
stagetoken  := "s" ("1".."6") [ "-" view ]        walk only
view        := "process" | "influence" | "both"
query       := key "=" value ( "&" key "=" value )*
```

Query keys, per mode. Unknown keys are dropped when the hash is next written. A default value is omitted from the hash, exactly as v1 omits `-process`.

| Mode | Key | Values | Default |
|---|---|---|---|
| walk | `d` | discipline id | omitted, meaning no field chosen |
| openings | `d` | discipline id | omitted |
| openings | `stage` | `1`..`6` | omitted, meaning all policy stages |
| openings | `closes` | `7`, `30`, `90`, `standing` | omitted, meaning any |
| openings | `open` | `anyone`, `organisation`, `parliamentarian` | omitted, meaning any |
| openings | `kind` | one or more `source_kind` values, comma separated, e.g. `kind=consultation,bill` | omitted, meaning any |
| openings | `q` | free text, `encodeURIComponent` | omitted |
| plan | `p` | encoded plan, section 2.3 | omitted |

Examples:

```
#/start
#/walk/s2-influence
#/walk/s2-influence?d=philosophy
#/walk/s4-both?d=civil-environmental-transport-eng
#/openings
#/openings?stage=4&closes=30&d=medicine-health
#/plan
#/plan?p=eyJ2IjoxLCJkIjoicGhpbG9zb3BoeSIsIm8iOlsiY3VyLTAxNyJdfQ
```

**v1 compatibility.** A bare v1 hash arriving at `/tool/`, matching `^#s([1-6])(?:-(process|influence|both))?$`, is upgraded once to `#/walk/s$1-$2` with `replaceState`. A shared v1 link therefore works if someone edits the path.

### 2.2 History behaviour

- Mode change uses `history.pushState`. Back moves between modes, which is what a reader expects.
- Every other change (policy stage, view, discipline, any filter, any keystroke in search) uses `history.replaceState`. Back never walks through filter states.
- `app.js` listens to both `popstate` and `hashchange`, guarded by an `isWriting` flag so its own writes do not re-enter the router.
- Filter and search writes are debounced at 250 ms.

### 2.3 Plan encoding in the hash

The plan must be shareable as a link. No compression library, because there is no build step.

```
p = base64url( utf8( JSON.stringify(shareShape) ) )
```

`shareShape` carries only what a second reader needs. Key names are one character to keep the hash short.

```
{ v: 1,                       schema version
  d: "philosophy",            discipline id or null
  t: { c: "...", w: "...", r: "...", x: "...", f: "...", o: "...", g: "..." },
                              the six target answers plus g, the government's own words
  o: ["cur-017", "leg-4412"], opening ids, resolved against loaded data at read time
  a: ["s2-a1", "s4-a0"],      ticked artefact keys
  w: { "cur-017": 2000 },     words per opening, for the translation buffer
  k: [ {n, r, d, s, x} ] }    contacts: name, role, date met, notes, next touch
```

Rules:
- Encode with `btoa(String.fromCharCode(...new TextEncoder().encode(json)))`, then `+` to `-`, `/` to `_`, strip `=`.
- Opening ids are resolved against loaded data at read time. An id that no longer resolves renders as a stub row: **"This opening is no longer in the data. It may have closed. Saved id: `{id}`."** The plan is never silently shortened.
- If the encoded string exceeds 8000 characters, the share button does not produce a link. See the "too long" state in section 4.
- Opening a `?p=` link never overwrites the plan already in this browser. It renders the shared plan read-only with a banner and one button, "Replace my plan with this one".

### 2.4 localStorage

Prefix `pt-`. v1 owns `fpp-stage` and `fpp-view` on the same origin, and the tool never reads or writes those two keys.

| Key | Type | Written when |
|---|---|---|
| `pt-schema` | `"1"` | on first write of any key |
| `pt-mode` | `"walk"` etc | on mode change |
| `pt-stage` | `"1"`..`"6"` | on policy stage change |
| `pt-view` | `"process"` etc | on view change |
| `pt-discipline` | discipline id | on discipline change, removed when cleared |
| `pt-filters` | JSON of the Mode B filter object | on filter change |
| `pt-plan` | JSON of the full plan, superset of `shareShape` | on any plan mutation, debounced 400 ms |
| `pt-seen-doors` | `"1"` | on first navigation away from `#/start` |

Every read and write is wrapped in `try/catch`. Private browsing with storage disabled degrades to a session that works and does not persist, with no error shown. If `pt-schema` is missing but `pt-plan` exists, the plan is read as v1 shape and `pt-schema` is set. If `pt-schema` is higher than the running code knows, the plan is left untouched, rendered read-only, and the banner reads: **"This plan was saved by a newer version of the tool. Download it before you change anything."**

**Precedence on boot:** hash, then localStorage, then defaults (`#/start`, policy stage 1, view `process`, no discipline).

---

## 3. Component inventory

Class naming: BEM-ish with a `pt-` prefix on everything new. Block `pt-card`, element `pt-card__title`, modifier `pt-card--tier1`. Transient states are `is-` or `has-` classes: `is-active`, `is-expired`, `is-loading`, `has-error`. Components inherited from v1 keep their v1 names unprefixed, so a reader of either file sees the same names.

### 3.1 Masthead, `.pt-masthead`

Extends v1's `.masthead`. One `h1`, the brand, plus chips and two links.

| Part | Copy | Notes |
|---|---|---|
| `h1.pt-masthead__title` | Federal Policy Pathways | Same as v1 |
| `p.pt-masthead__tagline` | Find your opening in federal policy, and build the plan to use it. | |
| `.chip.accent` | Prototype | Always first, always accent |
| `.chip` | Federal layer | |
| `.chip` | Verified {date} | Read from `stages.verified_on` at boot and formatted by `ui.dateLabel()`. One source of truth, never a second constant. The chip is omitted if `stages.json` carries no `verified_on` |
| `a.pt-masthead__link` | The explainer | `href="../"` |
| `a.pt-masthead__link.pt-masthead__link--feedback` | Tell us what is missing | `FEEDBACK_URL` with `?mode={mode}&discipline={id}` appended |

States: default only. No sticky behaviour, no collapse.

### 3.2 Mode bar, `.pt-modebar`

`<nav aria-label="Modes">` containing three `<button aria-pressed>`. Not links, because the mode is state, not a document.

| Button | Label | Sub-label, desktop only | id |
|---|---|---|---|
| 1 | Walk it | The six policy stages, read for your field. | `pt-tab-walk` |
| 2 | Openings | What is open now, and how to use it. | `pt-tab-openings` |
| 3 | Plan it | Your targets, dates and artefacts, saved here. | `pt-tab-plan` |

The Plan it tab carries a count badge `.pt-modebar__count` when the plan holds one or more openings: "Plan it **3**". `aria-label` on that button becomes "Plan it, 3 openings".

States: rest, hover, `aria-pressed="true"`, `:focus-visible`. No disabled state, all three modes are always reachable.

### 3.3 Context bar, `.pt-contextbar`

One line under the mode bar showing what is carried. Hidden (`hidden` attribute) when nothing is carried.

```
Field: Philosophy [x]   Policy stage 2 [x]   Start over
```

- `.pt-contextbar__item` for each carried value, with a `.pt-contextbar__clear` button, `aria-label="Clear field"` / `"Clear policy stage"`.
- The field name is a link to `#/start`.
- Left border 3px `--copper` when a discipline is set, `--line` when only a policy stage is set. The bar is about the reader's chosen line of action, so copper.

### 3.4 Situation card, `.pt-situation`

A `<button>`, one per record in `data/situations.json`.

```
.pt-situation__label      record.label, 17px semibold
.pt-situation__note       record.note, 14.5px --ink-2
.pt-situation__target     "Policy stage 4, Your opening"  mono 11px, --copper
```

On click: `ctx.go(record.route || '#/walk/s' + record.policyStage + '-' + record.view)`. The renderer honours `route` whenever the field exists and does not care where it points.

States: rest, hover (border `--copper`), `:focus-visible`, `:active`. No selected state, the card navigates away.

### 3.5 Discipline picker, `.pt-discipline-picker`

```
input#pt-discipline-search  type="search"
  label      "Search fields"
  placeholder "Type a field, a department or a committee"
h3 x6   one per CRDC division, in CRDC_DIVISIONS order
ul > li > button.pt-discipline   23 in total
```

- Search matches, case-insensitively, on `name`, `crdc_groups[]`, `lead_departments[]` and `committees[]`, so typing "ENVI" or "Health Canada" finds the fields that route there. Matched substring is wrapped in `<mark>`.
- A division whose items all filter out is removed from the DOM, heading included.
- `CRDC_DIVISIONS` is a constant in `app.js`, fixed order: Natural sciences; Engineering and technology; Medical, health and life sciences; Agricultural and veterinary sciences; Social sciences; Humanities and the arts. A record with an unrecognized `division` is grouped last under the heading "Other fields" and logged once to the console.
- `.pt-discipline` carries `.is-selected` and `aria-current="true"` when it matches `state.discipline`.
- Each button shows its `confidence` as a `.v` or `.v.check` chip, because the record's route weights are inferred.

States: default, filtered, `.is-selected`, no-match (section 4).

### 3.6 Stage track with the openings marker

v1's `.track` and `.stage-btn` unchanged, plus one child element.

```html
<button class="stage-btn" data-stage="2" aria-pressed="false"
        aria-label="Policy stage 2: Options. Your opening in Philosophy.">
  <span class="num">POLICY STAGE 2</span>
  <span class="name">Options</span>
  <span class="line">Public servants draft the choices.</span>
  <span class="meter" aria-hidden="true">…</span>
  <span class="meter-label">Open, hidden</span>
  <span class="pt-openflag pt-openflag--best">Your opening</span>
</button>
```

- `.pt-openflag` is hidden unless `state.discipline` is set and this policy stage appears in the record's `best_stages[]`.
- `.pt-openflag--best` on `best_stages[0]`, copy "Your opening", copper filled chip. `.pt-openflag--also` on any later entry, copy "Also open", copper outline chip.
- The openness meter stays `--meter-on` ink. It is understanding. The flag is copper. It is action. The two never merge.
- The `why` string is not on the button. It renders in the stage panel, section 3.7.

States: no discipline (no flags, and one line above the track: "Pick a field to see where your opening is."), discipline set, active policy stage, hover, focus.

### 3.7 Stage panel additions, Mode A

Above v1's `.panes`, when a discipline is set and the active policy stage is one of its `best_stages`:

```html
<div class="pt-opennote">
  <h3>Your opening in Philosophy</h3>
  <p>{best_stages[i].why}</p>
  <span class="v check">Check</span>
</div>
```

**The heading tracks rank, so it agrees with the flag on the track button above it.** `best_stages[0]` reads "Your opening in {field}", matching `.pt-openflag--best`. Any later entry reads "Also open in {field}", matching `.pt-openflag--also`. A panel that says "Your opening" under a button that says "Also open" contradicts itself, and the reader believes the one that is wrong.

Copper left border 3px, same shape as v1's `.mistake`. Present only on a policy stage listed in `best_stages`.

### 3.8 Actor panel, `.pt-actors`

Between the stage head and the panes. Renders `disciplines[d].actors`.

```
h3  Who you are dealing with
    .pt-actors__col--decision      h4 Decision makers   ul
    .pt-actors__col--influencers   h4 Influencers       ul
    .pt-actors__col--implementers  h4 Implementers      ul
    p.pt-actors__carriers          "Carriers: {influencers[].join(', ')}"
```

`actors.*` drives the three columns. The record's separate top-level `influencers[]` renders as the single "Carriers" line under the columns, since those are the organizations that carry work rather than people in the room.

Three columns at 900px and up, one column below. Green heading rules, because this is understanding.

States: no discipline (panel absent), present, empty column, loading (section 4).

### 3.9 Route list with weights

v1's `.routes` and `.route`, re-sorted and annotated.

- Sort: `route_weights[route.name]` descending, then original v1 order, which is already ranked by leverage. Stable sort.
- A route with no entry in `route_weights` gets weight 1 and a `.v.check` chip next to its weight.
- Weight display, inside the route header:

```html
<span class="pt-weight" title="Weight for Philosophy">
  <span class="meter meter--copper" aria-hidden="true"><i class="on"></i><i class="on"></i><i></i></span>
  <span class="pt-weight__label">Weight 2 of 3</span>
</span>
```

The accessible name lives in a visually hidden span: "Weight 2 of 3 for Philosophy".
- With no discipline set: original v1 order, no weights, and one line above the list: **"Pick a field to re-rank these routes."**
- `.routes-label` becomes an `<h4>`, styling unchanged, to fix the heading skip.
- Below the list, one link: **"See what is open at this policy stage"**, copper, to `#/openings?stage={N}&d={discipline}`.

### 3.10 Opening card, `.pt-opening`

The single most reused component. Rendered only by `PolicyTool.ui.openingCard()` in `app.js`. No mode file builds this markup itself.

```html
<article class="pt-opening" data-id="cur-017" data-tier="3">
  <header class="pt-opening__head">
    <h3 class="pt-opening__title"><a href="{source_url}" target="_blank" rel="noopener">{title}</a></h3>
    <p class="pt-opening__closes">Closes in 6 days, 9 Sept 2026</p>
  </header>
  <p class="pt-opening__body">{body}</p>
  <ul class="pt-opening__meta">
    <li><button class="pt-stagechip">Policy stage 4</button></li>
    <li class="pt-opening__owner">Health Canada</li>
    <li class="pt-opening__kind">Consultation</li>
    <li><span class="v">Verified</span> 3 Sept 2026</li>
  </ul>
  <div class="pt-opening__tip">
    <h4>How to intervene</h4>
    <p>{tip}</p>
  </div>
  <div class="pt-opening__actions">
    <button class="pt-btn pt-btn--copper" aria-pressed="false">Add to plan</button>
  </div>
</article>
```

Rules:
- Title links to `source_url`, always `target="_blank" rel="noopener"`.
- `.pt-opening__closes` copy comes from `PolicyTool.ui.closesLabel()`: "Closes today", "Closes in 1 day", "Closes in 6 days, 9 Sept 2026", "Standing, no deadline", "Closed 8 Sept 2026".
- The check chip is `.v` when `source_kind` is `consultation`, `bill`, `gazette` or `tender` (machine-fetched from an official feed) and `.v.check` when the record came from `curated.json` without a `verified_on` inside the last 90 days. `app.js` decides this, not the mode.
- **Owning body is not a field in the record shape**, so it is derived from `source_url` by `PolicyTool.ownerFor(record)` using a small host and path map in `app.js`: `ourcommons.ca/Committees/en/<ACRONYM>` resolves through `crosswalk.committees` to the committee's full name; `canada.ca/en/<slug>` resolves through a department slug table; `gazette.gc.ca` gives "Canada Gazette"; `canadabuys.canada.ca` gives "CanadaBuys"; `parl.ca/legisinfo` gives "Parliament of Canada". Anything unmatched omits the line rather than filling it with a guess. A derived owner carries no chip, because it is a label, not a claim.
- The tip block is copper left border. If no tip resolves, the block is replaced by the no-tip state, section 4.
- `Add to plan` is a toggle with `aria-pressed`. Label swaps to "In your plan". Copper filled when pressed.

Modifiers and states:

| State | Class | Visual | Copy change |
|---|---|---|---|
| Default | | | |
| In plan | `.is-inplan` | copper left border on the card | button reads "In your plan", `aria-pressed="true"` |
| Closing soon, 7 days or fewer | `.is-soon` | close line in copper, bold | |
| Expired, past `expires_on` | `.is-expired` | opacity .55, no hover lift | close line reads "Expired 8 Sept 2026. Left here for reference until 8 Oct 2026." Button replaced by a static `.pt-opening__closed` reading "Closed" |
| Standing | `.is-standing` | | close line "Standing, no deadline" |
| Tier 1 live | `data-tier="1"` | | no visual difference; tier appears only in the freshness banner |

### 3.11 Filter bar, `.pt-filterbar`

Mode B only. One search input, four selects, one reset.

| Control | id | Label | Options |
|---|---|---|---|
| search | `pt-f-q` | Search openings | free text |
| select | `pt-f-stage` | Policy stage | All policy stages, then "1. Agenda" through "6. Review" |
| select | `pt-f-domain` | Field | All fields, then the 23 discipline names, matched through `domains[]` |
| select | `pt-f-closes` | Closes within | Any time, 7 days, 30 days, 90 days, Standing |
| select | `pt-f-open` | Open to | Anyone, Organizations, Parliamentarian required |
| button | `pt-f-reset` | Clear filters | shown only when one or more filters are active |

- A `source_kind` filter is not a select. `source_kind` is shown as a row of toggle chips `.pt-kindchip` above the results, one per kind present in the loaded data, each `aria-pressed`. This keeps five selects from becoming six and puts the most-scanned facet in reach.
- Results line, `.pt-filterbar__count`: **"14 openings. 3 filters active."** Singular forms handled.
- Below 700px the whole bar collapses into `<details class="pt-filterbar pt-filterbar--collapsed"><summary>Filters (3 active)</summary>`.

States: default, active (count line, reset visible), no-match (section 4).

### 3.12 Freshness banner, `.pt-freshness`

Mode B only, above the filter bar. Three lines, one per tier, each with its own state. Never collapses to a single line, because the whole point is that the tiers are different.

```html
<div class="pt-freshness" role="status">
  <p class="pt-freshness__line pt-freshness__line--live">…</p>
  <p class="pt-freshness__line pt-freshness__line--build">…</p>
  <p class="pt-freshness__line pt-freshness__line--curated">…</p>
</div>
```

Copy in section 4.4.

### 3.13 House sitting indicator, `.pt-sitting`

Mode B, inside the freshness block as a fourth line with its own left marker. Also rendered in Mode A under the routes list when the active policy stage has a committee or parliamentarian route.

Copy in section 4.5.

### 3.14 Plan sections

Mode C renders six sections in this order, each an `<section>` with an `<h3>`.

| id | Heading | Contents |
|---|---|---|
| `pt-plan-target` | Your target | Six textareas from the intake, plus a read-only field line and one textarea for the government's own words. Autosaves on `input`, debounced 400 ms |
| `pt-plan-openings` | Openings you are working | Rows from `plan.openings`. Each row: title linking to `source_url`, close date, policy stage, a "Where this sits" link into Walk it, a words input, a Remove button |
| `pt-plan-artefacts` | Have in hand | Checkbox list generated from `stages[n].influence.assets[]` for every policy stage represented in `plan.openings`, plus the discipline's top `best_stages` entry. Each item shows a time estimate with a Check chip |
| `pt-plan-dates` | Dates | One table per opening, four rows, computed backwards from `closes` |
| `pt-plan-contacts` | Contacts | Repeating rows: name, role and body, date met, notes, next touch. Add row, remove row |
| `pt-plan-export` | Take it with you | Four controls, section 3.15 |

**The six target questions, verbatim from `tools/impact-planning-intake.md`:**

1. Who is different because of this work, beyond other researchers?
2. What changes for them? Be concrete.
3. Who is already waiting for this?
4. Who outside academia are you in contact with about this?
5. What is forcing this now?
6. Anything off the table? Sensitivities, community protocols, confidentiality.

Plus, not a question: **The government's own words you attach to.** Helper text: "A mandate letter line, a budget line, a throne speech sentence. Quote it."

**Date offsets**, one constant `PLAN_OFFSETS` in `mode-plan.js`, every derived date carrying a `.v.check` chip:

| Row | Date | Copy |
|---|---|---|
| Contact | close minus 21 days | Email the clerk or the director general |
| Draft done | close minus 14 days | Your draft finished |
| Translation starts | close minus `ceil(words / 2000)` business days | One business day per 2,000 words. Senate rule, applied to both chambers |
| Brief due | `closes` | The deadline itself, chip inherited from the record |

A date that has already passed renders in copper with "Passed" appended.

### 3.15 Export controls, `.pt-plan__export`

| Control | Label | Behaviour |
|---|---|---|
| button | Print the brief | `window.print()`. `print.css` produces the one to two page brief in what / so what / now what order |
| button | Copy as Markdown | `navigator.clipboard.writeText()`, label flips to "Copied" for 1500 ms |
| button | Download JSON | Blob, `policy-plan-{YYYY-MM-DD}.json` |
| button | Copy share link | Builds `#/plan?p=…`, copies the absolute URL |

Under them, one line, always visible: **"Everything you type stays in this browser. A share link carries your plan text inside the link, so send it only to people you want reading it."**

### 3.16 Shared small components

| Class | Purpose | States |
|---|---|---|
| `.pt-btn`, `.pt-btn--copper`, `.pt-btn--ghost` | Buttons | rest, hover, focus, `aria-pressed`, `:disabled` |
| `.pt-stagechip` | "Policy stage 4", clickable into Walk it | rest, hover, focus |
| `.pt-kindchip` | source_kind toggle | `aria-pressed` |
| `.pt-empty` | Shared empty state: h3, p, optional action button | one shape, many copies |
| `.pt-skeleton` | Loading placeholder block | static under reduced motion |
| `.pt-banner`, `--info`, `--warn`, `--error` | One-line notices | |
| `.pt-sr` | Visually hidden | |

---

## 4. States and their copy

Every data-bearing view answers all of these. Copy is final, not placeholder.

### 4.1 Boot

| State | Where | Copy |
|---|---|---|
| Loading | Full page, before `stages.json` resolves | Heading: "Loading." Body: "Fetching the policy stages." |
| Error, stages failed | Full page, replaces everything below the masthead | Heading: "The policy stages did not load." Body: "Reload the page. If it keeps failing, `data/stages.json` is missing or malformed." Action: "Reload" |
| Error, a secondary file failed | `.pt-banner--warn` under the mode bar, dismissible | "{Fields / Committees / Tips / Sitting weeks} did not load. The rest of the tool works. Some panels will be thinner than usual." |
| Mode not registered | `.pt-empty` in the outlet, in place of the mode | Heading: "This mode is not built yet." Body: "The file that renders it is not loaded. Walk it works, and so does the front door." Action: "Back to the start" |

The last row covers a mode file that failed to load, whether because it does not exist yet during the build or because the request failed in production. `app.js` renders it whenever `PolicyTool.modes[name]` is absent, so a missing script never white-screens the tool.

### 4.2 Walk it

| State | Copy |
|---|---|
| No discipline | Above the track: "Pick a field to see where your opening is." Above the routes: "Pick a field to re-rank these routes." Actor panel absent, no flags |
| Discipline set, no actors mapped for a column | Inside the column: "Not mapped yet for this field." plus `.v.check` |
| Discipline set, `best_stages` empty | No flags, and above the track: "No opening is ranked for this field yet." plus `.v.check` |
| Disciplines file failed | Field door hidden, context bar hides the field item, banner from 4.1 |

### 4.3 Openings board

| State | Copy |
|---|---|
| Loading | Six `.pt-skeleton` cards, plus `role="status"` text: "Loading the board." |
| Live fetch in flight, other tiers ready | Board renders tiers 2 and 3 immediately. Live line reads: "Checking open.canada.ca for live consultations." |
| Live fetch failed | Board still renders. Live line becomes `.pt-freshness__line--error`: "Live consultations did not load. The board below is the daily build plus the curated list, so it still works." Action: "Retry" |
| Nothing new today | Above the board, `.pt-banner--info`: "Checked today, nothing new. The {n} openings below are still live." Never a blank board when records exist |
| No records at all after a successful load | `.pt-empty`: heading "Nothing is open right now." Body: "That is unusual, so check the source links before you take it as read. The board rebuilds every morning." Action: "Tell us what is missing" |
| Filters match nothing | `.pt-empty`: heading "No openings match these filters." Body: "{n} openings are open with the filters cleared." Action: "Clear filters" |
| Search matches nothing | `.pt-empty`: heading "No openings match \"{q}\"." Body: "Try a department, a committee acronym, or a shorter word." Action: "Clear search" |
| Records dropped for a bad shape | Appended to the build line: "{n} records were skipped because they were missing a date or a source." Never silent |
| Expired item | Card class `.is-expired`. Close line: "Expired 8 Sept 2026. Left here for reference until 8 Oct 2026." Button replaced by "Closed" |
| No tip resolves | Tip block replaced by `.pt-opening__tip--none`: "No tip written for this kind of opening yet." plus `.v.check` |

### 4.4 Freshness banner copy

| Tier | State | Copy |
|---|---|---|
| Live | fresh, under 2 minutes | Consultations live from open.canada.ca, fetched just now. |
| Live | fetched earlier this session | Consultations live from open.canada.ca, fetched at 10:42. |
| Live | in flight | Checking open.canada.ca for live consultations. |
| Live | failed | Live consultations did not load. The board below is the daily build plus the curated list, so it still works. **Retry** |
| Build | fresh, under 48 hours | Bills, Gazette and tenders updated 3 Sept 2026. |
| Build | stale, 48 hours or older | Bills, Gazette and tenders last updated 1 Sept 2026, more than 48 hours ago. Check the source before you rely on a date. `.pt-freshness__line--warn` |
| Build | file missing | The daily build did not load. Curated items below are unaffected. |
| Curated | always | Curated items each show their check date. |

### 4.5 House sitting copy

| State | Copy |
|---|---|
| Sitting this week | The House is sitting this week. Committee and parliamentarian routes are live. |
| Not sitting, next week known | The House is not sitting this week. Committee and parliamentarian routes resume 21 Sept 2026. |
| Not sitting, no next week in the data | The House is not sitting this week. The calendar in the tool ends 19 Dec 2026. `.v.check` |
| File failed | House sitting weeks did not load. Check the calendar before you count on a committee route. `.v.check` |

### 4.6 Plan it

| State | Copy |
|---|---|
| Empty | `.pt-empty`: heading "Your plan is empty." Body: "Add an opening from the Openings board, or start with the six questions below. Everything you type stays in this browser." Action: "Go to Openings" |
| Openings empty, questions answered | Inside the openings section: "No openings added yet. The board is where you pick them." Action: "Go to Openings" |
| Artefacts, nothing to generate | "The artefact list builds from the policy stages of the openings you add." |
| Dates, nothing to compute | "Dates appear once an opening with a close date is in the plan." |
| A saved opening no longer resolves | Row renders as `.pt-plan__row--orphan`: "This opening is no longer in the data. It may have closed. Saved id: `{id}`." Remove button still works |
| Share link too long | Replaces the button with `.pt-banner--warn`: "This plan is too long to fit in a link. Download the JSON and send that instead." |
| Clipboard blocked | Button label flips to "Copy unavailable" for 1500 ms, and a line appears: "Your browser blocked the clipboard. Use Download instead." |
| Shared plan opened via `?p=` | `.pt-banner--info` above everything: "You are reading a shared plan. Your own plan is untouched." Action: "Replace my plan with this one" |
| Storage unavailable | `.pt-banner--warn` once: "This browser is not saving your plan. Download it before you close the tab." |
| Newer schema | Section 2.4 |

### 4.7 Front doors

| State | Copy |
|---|---|
| Search matches no field | `.pt-empty`: heading "No field matches \"{q}\"." Body: "Twenty-three fields are listed. Try a broader word, a department, or a committee acronym." Action: "Clear search" |
| Situations file failed | Situations block hidden entirely, and above the field door: "The situation cards did not load. Pick a field instead." |

---

## 5. Copy rules

The tool speaks the way Prem writes. These are enforceable, not aspirational.

1. **Affirmative and specific.** "Closes in 6 days" beats "closing soon". "Email the committee clerk" beats "consider reaching out".
2. **Canadian English.** behaviour, labour, defence, centre, programme is not used ("program" is the Canadian usage), licence as a noun and license as a verb, analyse, catalogue. On the `-ize` / `-ise` fork, follow v1: it writes "organization" and "summarized", so the tool writes `-ize` throughout its copy. The one exception is the data value `open_to: "organisation"`, which the record shape fixes and which is never shown raw. The board's filter option reads "Organizations".
3. **No em dashes anywhere.** Commas, full stops or colons. This applies to data files, code comments, and the spec itself.
4. **No filler.** No "please note", "simply", "just", "in order to", "we're excited to", "leverage" as a verb, "utilize". No exclamation marks.
5. **Every factual claim on screen carries a chip.** `.v` Verified or `.v.check` Check, reusing v1's markup exactly. A claim is any statement about how government works, what a rule is, or when something happens. UI labels and headings do not carry chips. Where a value is derived by the tool rather than stated in the data (a computed date, a time estimate, an inferred owner) the chip is always Check.
6. **"Policy stage" everywhere.** "Policy stage 4", "Policy stages", `aria-label="Policy stages"`. The planner has sections, not stages. The mode bar has modes, not stages. The intake has questions, not stages.
7. **Dates in Canadian long form**, matching v1: "8 Sept 2026". Months abbreviated to four characters or fewer stay whole: Jan, Feb, Mar, Apr, May, June, July, Aug, Sept, Oct, Nov, Dec. One formatter, `PolicyTool.ui.dateLabel()`, is the only place a date is turned into text.
8. **Numbers.** Spell out one to nine in prose, use numerals for policy stages, counts in UI chrome, page counts and day counts. "Ten pages maximum", "Closes in 6 days", "14 openings".
9. **Second person, present tense.** "You need", "Closes", "Email the clerk". Never "users can".
10. **Honest about being a prototype.** The Prototype chip is in the masthead, the feedback link is in the masthead and in every empty state that has an action slot. The tool never claims completeness it does not have.
11. **No invented precision.** Where v1's hard-coded counts ("876 consultations") would be tempting, the tool either reads a count from data at render time or omits it.

---

## 6. Accessibility

### 6.1 Heading hierarchy

One `h1` per page, in the masthead. No level is skipped anywhere.

| Level | Front doors | Walk it | Openings | Plan it |
|---|---|---|---|---|
| h1 | Federal Policy Pathways (masthead, all modes) | | | |
| h2 | "What's your situation?", "What's your field?" | The policy stage name | "Openings" | "Plan it" |
| h3 | CRDC division names | "Your opening in {field}", "Who you are dealing with", "The machine", "Your opening" | Each opening card's title | Each plan section |
| h4 | | `.sec` labels, actor column headings, "Routes" (was a `<p>`, now an `h4`), "Have in hand", "The mistake people make" | "How to intervene" inside a card | Sub-blocks inside a section |
| h5 | | Route names, `.tracklet` headings | | |

Situation cards, discipline buttons and mode tabs are buttons, not headings.

### 6.2 Keyboard

| Element | Behaviour |
|---|---|
| Skip link `.pt-skip` | First tab stop, target `#pt-outlet` |
| Mode bar | Three tab stops, `Enter` and `Space` activate. Not a roving tabindex, because these are buttons that change state, not an ARIA tablist |
| Stage track | Six tab stops. `ArrowLeft` and `ArrowRight` move between policy stages when focus is inside the track. The global arrow-key handler from v1 is kept but skips when focus is in an input, textarea, select or `contenteditable` |
| Segmented view control | Three tab stops, `aria-pressed` on each |
| Filter bar | Search, then four selects, then the kind chips, then reset |
| Opening card | Title link, policy stage chip, Add to plan. Three stops per card, in that order |
| Plan rows | Fields in visual order, Remove last in each row |
| `details.rules` and the collapsed filter bar | `summary` is a native tab stop |

Focus is never trapped. There is no modal in this tool. The Pathways site's quick-match modal is deliberately not borrowed, because both front doors fit on the page and a modal would add a focus-trap surface for no gain.

### 6.3 `aria-pressed` on toggles

Every toggle carries `aria-pressed`, and its value is computed from the **effective** state, not the stored one:

- mode tabs
- segmented view control (this is where v1 has the bug: under 1000px `both` falls back to `process`, and the pressed state must follow the fallback)
- `Add to plan`
- `.pt-kindchip`
- artefact checkboxes use a real `<input type="checkbox">`, not a toggle button

### 6.4 Focus management on mode switch

1. `destroy()` on the outgoing mode empties the outlet.
2. `render()` on the incoming mode fills it. Its `h2` carries `tabindex="-1"`.
3. `app.js` calls `outlet.querySelector('h2').focus({ preventScroll: true })`.
4. `#pt-live` receives one sentence: "Openings. 14 openings." / "Walk it. Policy stage 2 of 6." / "Plan it. 3 openings, 6 questions."

Within a mode, changing the policy stage or a filter does **not** move focus. Filter results announce through `#pt-live`, debounced to one announcement per 800 ms so a fast typist is not read a stream of counts.

Adding to the plan announces: "Added to your plan. 3 openings." Removing announces: "Removed from your plan. 2 openings."

### 6.5 Reduced motion

Extends v1's rule:

```css
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
  html { scroll-behavior: auto; }
  .pt-skeleton { animation: none; background: var(--line-2); }
}
```

Every `scrollIntoView` and `window.scrollTo` reads `matchMedia('(prefers-reduced-motion: reduce)')` and passes `behavior: 'auto'` when it matches.

### 6.6 Touch targets and pointers

```css
@media (pointer: coarse) {
  .pt-btn, .pt-stagechip, .pt-kindchip, .pt-discipline,
  .pt-situation, .pt-modebar button, .pt-contextbar__clear { min-height: 44px; }
}
```

`.stage-btn` is already 108px tall. Clear buttons in the context bar get padding rather than a bigger glyph, so the row height does not grow.

### 6.7 Colour

- Colour never carries meaning alone. The openings marker is a copper chip **with the words "Your opening"**. The weight meter has a text label. An expired card has both reduced opacity and the word "Expired".
- Contrast, measured against the v1 tokens:

| Pair | Light | Dark | Verdict |
|---|---|---|---|
| `--accent` on `--surface-2` | 6.2:1 | 7.1:1 | Pass AA everywhere |
| `--accent` on `--surface` | 5.8:1 | 6.8:1 | Pass AA everywhere |
| `--copper` on `--surface-2` | 4.6:1 | 6.5:1 | Pass AA for body text |
| `--copper` on `--surface` | **4.3:1** | 6.1:1 | **Fails AA in light theme for text under 18px** |
| `--copper` on `--copper-soft` | **3.7:1** | 5.1:1 | Large or bold text only in light theme |

  Fix, and the only new token: `--copper-text`, light `#8F4C21`, dark `#D98D57` (unchanged). It scores 6.1:1 on `--surface` and 5.2:1 on `--copper-soft` in light theme. **Rule: `--copper` for borders, meters, markers, icons and text at 18px or larger or bold. `--copper-text` for copper text below that size.** This applies to the tip block heading, the close line, the weight label and the `.v.check` chip.
- `.v.check` at 11px is copper text, so it uses `--copper-text` and keeps `--copper` for its border.
- Focus rings stay `--accent` at 2px with 2px offset, on every interactive element including inside the copper components, because a second focus colour would read as a state.

### 6.8 Landmarks and labels

- `<header>`, `<nav aria-label="Modes">`, `<nav aria-label="Policy stages">`, `<main id="pt-outlet">`, `<footer>`.
- The board is `<ul class="pt-board">` of `<li>` wrapping each `<article class="pt-opening">`, so a screen reader announces the count.
- Every `<select>` and `<input>` has a visible `<label>` with `for`. No placeholder-as-label anywhere.
- `#pt-live` is `aria-live="polite" aria-atomic="true"`, visually hidden, never used for anything but announcements.

---

## 7. Responsive

Mobile first. Three breakpoints only, matching v1's: 700px, 1000px, and one new one at 760px for the board grid.

### 7.1 Stage track

Unchanged from v1: `grid-template-columns: repeat(6, minmax(150px, 1fr))` with `overflow-x: auto` and `scroll-snap-type: x proximity`, becoming `repeat(6, 168px)` below 700px so all six are reachable by swipe.

- The `.pt-openflag` must survive the 168px column. It sits below the meter label at 11px mono, wrapping to two lines if it must.
- On selection, `scrollIntoView({ block: 'nearest', inline: 'center' })` below 700px so the active policy stage is not pinned to an edge. `inline: 'nearest'` at and above 700px, as v1 does.
- The track gets a fading right edge, a CSS `mask-image`, below 700px so the horizontal scroll is discoverable. No JS.

### 7.2 View control

`both` stays desktop only at 1000px and up, as in v1. Below that the control shows two buttons and the effective view is `process` or `influence`. `aria-pressed` follows the effective value.

### 7.3 Board

| Width | Columns | Filter bar |
|---|---|---|
| below 700px | 1 | Collapsed into `<details>` with an active count |
| 700 to 759px | 1 | Expanded, controls stack full width |
| 760 to 1099px | 2 | Expanded, two rows of controls |
| 1100px and up | 2 | Expanded, one row |

Two columns is the maximum. Each card carries a paragraph of body plus a tip, and three columns puts the tip below a readable measure.

### 7.4 Front doors

Situation cards: 1 column below 560px, 2 columns to 900px, 4 columns above.
Discipline picker: 1 column below 700px, 2 columns to 1000px, 3 columns above. Division headings always span the full row.

### 7.5 Planner

Single column at every width, because it is a form and a form reads down.

- Below 700px the dates table becomes stacked rows using v1's `.live li` pattern (`grid-template-columns: 1fr`), label above value.
- The contacts log becomes one card per contact below 700px, with the five fields stacked.
- Export buttons: a row above 480px, full width and stacked below.
- Textareas: `min-height: 88px`, `resize: vertical`, `max-width: 66ch` matching v1's measure.

### 7.6 Print

`print.css` is Sonnet UI's file. What it must produce, so the spec is buildable:

- Hides `.pt-masthead` chips and links, the mode bar, the context bar, the filter bar, the freshness banner, every button, and all modes other than Plan it.
- Shows `#pt-print`, populated by `mode-plan.js`, in what / so what / now what order: the target answers as "What", the openings and the government's own words as "So what", the artefacts, dates and contacts as "Now what".
- One to two pages at A4 and US Letter. `@page { margin: 18mm }`. Serif body, no background fills, black on white, links rendered with their href in brackets.
- Page-break rules: `.pt-print__section { break-inside: avoid }` on the short sections, `break-before: auto` elsewhere.

---

## 8. Data contract

### 8.1 Where files live

All eight JSON files are fetched from `../data/` relative to `/tool/`, with `cache: 'no-cache'` so a fresh build is picked up without a hard reload.

```
../data/stages.json        required
../data/situations.json    optional
../data/disciplines.json   optional
../data/crosswalk.json     optional
../data/tips.json          optional
../data/curated.json       optional
../data/feeds.json         optional
../data/sitting.json       optional
```

"Required" means the tool cannot render without it. "Optional" means the tool degrades with a named banner and keeps working.

### 8.2 Record shapes, verbatim

Opening record, identical across all three tiers:

```
{ id, title, body, policyStage (1-6), domains[], opens, closes, open_to ("anyone"|"organisation"|"parliamentarian"),
  source_url, source_kind ("consultation"|"bill"|"gazette"|"tender"|"committee"|"funding"|"appointment"|"review"),
  verified_on, expires_on, tip }
```

```
data/feeds.json       { built_at, sources: { legisinfo: {fetched_at, count, ok}, gazette: {...}, canadabuys: {...} }, records: [Opening] }
data/curated.json     { verified_on, records: [Opening] }
data/stages.json      { verified_on, stages: [ the six v1 STAGES objects, HTML strings already resolved ] }
data/situations.json  { situations: [{ id, label, policyStage, view, note, route? }] }
                      route is optional. When present it is a full hash string and the card navigates
                      there instead of into Walk it. policyStage and view stay on the record and still
                      drive the card's target line.
data/disciplines.json { verified_on, disciplines: [{ id, name, division, crdc_groups[], domains[], lead_departments[],
                        committees[], evidence_culture, best_stages[{policyStage, why}], route_weights{routeName: 1|2|3},
                        influencers[], actors{decision_makers[], influencers[], implementers[]},
                        hook{text, date, confidence}, confidence }] }
data/crosswalk.json   { verified_on, committees: [{ acronym, name, chamber, departments[], domains[], senate_counterpart,
                        about_url, confidence }] }
data/tips.json        { tips: { "<source_kind>": { "default": text, "<policyStage>": text } } }
data/sitting.json     { session, source_url, verified_on, sitting_weeks: [{start, end}] }
```

Live tier, owned by another engineer in `tool/feeds-live.js`:

```
window.PolicyFeeds.loadLive()  -> Promise<{ records: [Opening], fetched_at, errors: [string] }>
window.PolicyFeeds.loadNews()  -> Promise<[{ title, link, teaser, publishedDate }]>
```

### 8.3 Domain ids, fixed at 18

```
health, environment-climate, energy-natural-resources, agriculture-food, fisheries-oceans,
science-research-innovation, digital-data-privacy, economy-finance-trade, labour-skills-social,
education-youth, immigration-multiculturalism, justice-rights-security, indigenous,
culture-heritage-media, official-languages, transport-infrastructure-housing,
international-defence, governance-public-administration
```

`app.js` holds this list as `DOMAINS`, with a display label per id. A record carrying a domain id outside this list has that id dropped and logs once to the console. The list never grows without a spec change.

### 8.4 Load sequence

1. `boot()` fetches all eight files in parallel with `Promise.allSettled`.
2. `stages.json` rejected or malformed, the boot error state renders and nothing else runs.
3. Each other rejection sets a flag consumed by the section 4.1 warning banner.
4. Indices are built once, section 8.5.
5. The router reads the hash, then localStorage, and activates a mode.
6. **Tier 1 is lazy.** `PolicyFeeds.loadLive()` is called on the first activation of Mode B, never on boot, and its result is cached on `data.live` for the session. `loadNews()` is called at the same time and is decorative: if it rejects, the news strip is simply absent and no error is shown, because a ticker is not a claim the tool is making.

### 8.5 Derived indices, built once in `app.js`

| Index | Shape | Notes |
|---|---|---|
| `data.stageById` | `Map<number, Stage>` | |
| `data.disciplineById` | `Map<string, Discipline>` | |
| `data.committeeByAcronym` | `Map<string, Committee>` | from `crosswalk.committees` |
| `data.domainToDisciplines` | `Map<domainId, string[]>` | inverted from each discipline's `domains[]`, drives the Field filter on the board |
| `data.openings` | `Opening[]` | the merge, below |

**Merge rule.** Concatenate `curated.records`, `feeds.records`, `live.records` in that order. Deduplicate on `id` first, then on normalized `source_url` (lower-cased, trailing slash and query stripped). **First wins**, so curated beats the build beats live, because a curated record carries a hand-written tip and a human check date. Each surviving record is stamped with `_tier` (3, 2 or 1) for the freshness banner only.

**Sort.** By effective close date ascending. Standing items last, then alphabetical by title. Expired items are sorted with the rest and rendered grey in place, not pushed to the bottom, so a reader sees that the window just shut.

**Bucketing.** `closes` more than 365 days out is treated as `standing`, per the plan's finding about standing engagements in the consultations registry.

**Expiry.** `expires_on` in the past means `.is-expired`. `expires_on` more than 30 days past means the record is not rendered at all and is not counted anywhere.

**Validation.** A record is dropped when it lacks any of `id`, `title`, `policyStage`, `source_url`, `source_kind`, `verified_on`, or when `policyStage` is outside 1 to 6. Dropped records are counted, and the count is shown in the freshness banner, section 4.3. The tool never drops data silently.

**Tip resolution**, `PolicyTool.tipFor(record)`:

```
record.tip
  || tips[record.source_kind][String(record.policyStage)]
  || tips[record.source_kind].default
  || null
```

`null` renders the no-tip state.

### 8.6 Artefact time estimates

`stages.json` carries `assets[]` as plain strings with no time field, so the estimate has no home in the data contract. Interim mechanism, and open question 1:

`app.js` holds `ARTEFACT_TIME`, a small keyword table mapping a matched phrase to an estimate. `PolicyTool.artefactTime(text)` returns `{ label, confidence: 'check' }`.

| Match | Estimate |
|---|---|
| "one page", "one-pager" | Half a day |
| "two-page", "two- to four-page", "evidence note", "synthesis" | Two days |
| "ten pages", "the brief" | Four days |
| "costed", "number", "cost estimate" | Two days |
| "contact", "named contact", "organization name" | An hour |
| "bilingual", "translation" | One business day per 2,000 words |
| anything else | Half a day |

Every estimate renders with a `.v.check` chip. No estimate is ever presented as fact.

---

## 9. Engineering conventions

### 9.1 Files and load order

Owner column is from the plan and is binding.

| File | Owner |
|---|---|
| `tool/index.html` | Opus UX |
| `tool/styles.css` | Opus UX |
| `tool/app.js` | Opus UX |
| `tool/mode-walk.js` | Opus UX, the reference implementation |
| `tool/mode-openings.js` | Sonnet UI |
| `tool/mode-plan.js` | Sonnet UI |
| `tool/feeds-live.js` | Sonnet feeds |
| `tool/print.css` | Sonnet UI |

Plain `<script src>`, no `type="module"`, no `defer`, no bundler, no framework, no dependency. Fixed order at the end of `<body>`:

```html
<script src="app.js"></script>
<script src="feeds-live.js"></script>
<script src="mode-walk.js"></script>
<script src="mode-openings.js"></script>
<script src="mode-plan.js"></script>
<script>PolicyTool.boot();</script>
```

`app.js` defines `window.PolicyTool` and does **not** boot itself. Each mode file is a single IIFE that registers itself and touches nothing else at load time. `feeds-live.js` defines `window.PolicyFeeds` and fetches nothing at load time.

**`tool/modes.css`, optional, owner Sonnet UI.** Where a component Modes B or C need has no rule in `styles.css`, Sonnet UI may add `tool/modes.css` rather than editing a file it does not own. It is linked after `styles.css` so its rules win on equal specificity, and it follows the same conventions: `pt-` prefix, BEM-ish, `is-` and `has-` state classes never styled bare, no ids in selectors, no `!important`, tokens from Appendix A only. Opus UX reviews it at the consistency review and merges whatever belongs in `styles.css` back into `styles.css`, so the split is temporary by design.

### 9.2 The module contract

```js
window.PolicyTool.modes.openings = {
  init(ctx)    { /* once per ACTIVATION of this mode, not once per page load.
                    Register global listeners here. Build nothing into the DOM. */ },
  render(ctx)  { /* every state change while this mode is active. Must be idempotent. */ },
  destroy()    { /* on deactivation. Drop this mode's own references. Empty nothing:
                    app.js clears the outlet and removes every ctx.on listener. */ }
};
```

**`init` runs on every activation, not once per page load**, because `app.js` removes every `ctx.on` listener when a mode is deactivated, so a mode returning to the screen has to register them again. The lifecycle is symmetric: activate, `init`, `render`, deactivate, `destroy`, teardown. A mode that registers its global listeners once per page load loses them the first time the reader leaves and comes back.

Rules a mode must follow:

1. A mode writes only inside `ctx.outlet`. It never touches the masthead, the mode bar, the context bar or `#pt-live`.
2. A mode never writes `location.hash` or `localStorage` directly. It calls `ctx.go()` or `ctx.setState()`.
3. A mode never fetches. All data arrives on `ctx.data`.
4. A mode never builds an opening card, a chip, a meter or an empty state by hand. It calls the shared renderer.
5. Every listener a mode adds outside its own outlet subtree is registered through `ctx.on()`, in `init` rather than in `render`, and `app.js` removes it on deactivation. Registering one in `render` stacks another copy on every state change. Listeners on elements inside the outlet need no cleanup, because the outlet is emptied.
6. `render()` may be called many times in a row. It rebuilds from `ctx.state` and never diffs by hand.
7. `render` receives a fresh `ctx` each time and `init` only ever sees the one from its own activation, so a global listener must read the latest `ctx` from a module-local variable the mode refreshes at the top of `render`. `mode-walk.js` calls that variable `cur`.

### 9.3 `ctx`

```js
ctx = {
  state,               // frozen snapshot: {mode, policyStage, view, discipline, filters, plan}
  data,                // everything from section 8.5, plus data.live once loaded
  outlet,              // the <main> element, already emptied
  ui,                  // the shared renderers, section 9.4
  go(hash),            // navigate. pushState for a mode change, replaceState otherwise
  setState(patch),     // merge, persist, re-render the active mode, update the hash
  plan,                // the plan API, section 9.5
  on(target, evt, fn), // registers for automatic teardown
  off(target, evt, fn),
  announce(text),      // writes to #pt-live
  format               // dateLabel, closesLabel, daysUntil, plural
};
```

`ctx.state` is a frozen shallow copy. A mode that mutates it gets a thrown error in development, which is the intent.

### 9.4 Shared renderers in `app.js`

Every one of these returns a DOM element, never an HTML string, except where noted. Strings from data files that v1 already stores as HTML (`stage.process.what`, route `rules[]`) are inserted with `innerHTML`, because they arrive from a file this repo owns. Everything else uses `textContent`.

| Function | Returns | Notes |
|---|---|---|
| `ui.openingCard(record, {inPlan, showTip = true})` | `<article class="pt-opening">` | The only place this markup exists |
| `ui.chip(text, kind)` | `<span>` | kind: `plain`, `accent`, `verified`, `check` |
| `ui.stageChip(policyStage, {link = true})` | `<button class="pt-stagechip">` | "Policy stage 4" |
| `ui.meter(n, {of = 5, big, copper})` | `<span class="meter">` | v1's markup, `aria-hidden` |
| `ui.empty({title, body, actionLabel, onAction})` | `<div class="pt-empty">` | The only empty state |
| `ui.skeleton(count)` | `<div>` of `.pt-skeleton` blocks | |
| `ui.banner(kind, text, {actionLabel, onAction})` | `<div class="pt-banner">` | kind: `info`, `warn`, `error` |
| `ui.button(label, {variant, pressed, onClick})` | `<button class="pt-btn">` | |
| `ui.dateLabel(iso)` | string | "8 Sept 2026" |
| `ui.closesLabel(record)` | string | section 3.10 |
| `ui.field(labelText, control)` | `<div>` with a real `<label for>` | Used by every form control |

`app.js` also exports `PolicyTool.tipFor(record)` and `PolicyTool.artefactTime(text)`.

### 9.5 The plan API and how `Add to plan` works

The plan lives in `app.js`. Mode C is a view over it, never its owner. This is what lets Mode B add an opening before Mode C has ever been rendered.

```js
PolicyTool.plan = {
  add(record),            // returns true if added, false if already present
  remove(id),
  has(id),                // Mode B uses this to set .is-inplan on render
  count(),
  get(),                  // deep copy
  setField(path, value),  // "target.change", "words.cur-017", "contacts.2.notes"
  addContact(), removeContact(i),
  toggleArtefact(key),
  replaceWith(planObject),// used by the shared-link "Replace my plan" action
  clear()
};
```

Sequence when a reader presses `Add to plan`:

1. `mode-openings.js` calls `ctx.plan.add(record)`.
2. `app.js` stores `{id, title, closes, policyStage, source_url, source_kind}` on `state.plan.openings`, deduped by `id`. The full record is not stored, so a stale plan cannot contradict fresh data. Everything else is re-resolved from `data.openings` at render.
3. `app.js` writes `pt-plan` to localStorage, debounced 400 ms.
4. `app.js` emits `plan:change` on its bus and updates the Plan it tab count.
5. `mode-openings.js` listens for `plan:change` and re-renders that one card, not the board.
6. `mode-plan.js` listens for `plan:change` and re-renders only if it is the active mode. If it is not active, it does nothing: its next `render()` reads current state.
7. `app.js` announces "Added to your plan. 3 openings."

The bus is eight lines: `PolicyTool.bus = { on, off, emit }`. Events: `state:change`, `plan:change`, `data:live`, `mode:change`.

### 9.6 CSS conventions

- One file, `tool/styles.css`, in this order: v1 tokens, v1 base and inherited components, `pt-` shell, `pt-` shared components, mode-specific blocks, media queries last and grouped by breakpoint.
- Prefix every new class `pt-`. BEM-ish: `pt-block__element--modifier`. State classes are `is-` or `has-` and are never styled without a block: `.pt-opening.is-expired`, never a bare `.is-expired`.
- No ids in selectors. Ids are for JavaScript and for `label for`.
- No `!important` except in the reduced-motion block, which v1 already established.
- Nesting depth of two at most.
- New tokens go in `:root` and in both dark blocks. Appendix A is the complete list; adding a token outside it needs a spec change.
- A mode file never sets inline styles. If a value must vary at runtime it is set as a CSS custom property on the element, for example `--pt-weight: 2`.

### 9.7 JavaScript conventions

- One IIFE per file, `'use strict'`.
- No optional chaining on the left of an assignment, no top-level `await`, nothing that needs a transpiler. `const`, `let`, arrow functions, template literals, `Map`, `Promise.allSettled` and spread are all in scope.
- Every `localStorage`, `JSON.parse`, `history` and `clipboard` call is wrapped in `try/catch`, matching v1.
- No console output in normal operation. `console.warn` once per distinct data problem, never per record.
- Dates are handled as `YYYY-MM-DD` strings and compared as strings where possible. Where arithmetic is needed, construct with `new Date(y, m - 1, d)` in local time and never with `new Date("2026-09-08")`, which is parsed as UTC and drifts a day in Eastern time.

---

## 10. Open questions for the director

1. **Artefact time estimates have no home in the data contract.** `stages.json` carries `assets[]` as plain strings. The spec ships a keyword table in `app.js` with every estimate chipped Check. Confirm that, or add a `time` field to the assets and give it to Opus subject.

2. **Situation cards land in Walk it, and one of the eight fights it.** "A consultation just opened" names a live thing, and Walk it has no live things in it. The plan says situation cards route to a policy stage and view, so that is what is spec'd, with a copper cross-link from every policy stage panel into the board. Worth a decision on whether that one card should route to `#/openings?kind=consultation` instead.

3. **`disciplines.json` carries `influencers[]` and `actors.influencers[]`.** The spec renders `actors.influencers[]` as the middle column of the actor panel, and the top-level `influencers[]` as a "Carriers" line beneath. Confirm that is the intended split, or the panel is reading the wrong field.

4. **`FEEDBACK_URL` is a `mailto:` placeholder** until Prem supplies a form. The spec appends `?mode=` and `?discipline=` as query parameters, which a `mailto:` cannot carry, so the placeholder puts them in the subject line instead. Fine for the prototype, and the shape changes when the real URL lands.

---

## Appendix A: new tokens

Every one is added to `:root`, to the `prefers-color-scheme: dark` block, and to `[data-theme="dark"]`. Nothing else is added.

| Token | Light | Dark | Used by |
|---|---|---|---|
| `--copper-text` | `#8F4C21` | `#D98D57` | copper text under 18px: tip heading, close line, weight label, `.v.check` text |
| `--tier-1` | `#2E6B5B` | `#6FB39D` | the live freshness line's left marker |
| `--tier-2` | `#79837F` | `#8B948F` | the build line's marker |
| `--tier-3` | `#B0602B` | `#D98D57` | the curated line's marker |
| `--warn-soft` | `#F7EFD9` | `#332C18` | `.pt-banner--warn` background |
| `--error-soft` | `#F6E2DE` | `#3A211D` | `.pt-banner--error` background |
| `--error-ink` | `#8C2F1E` | `#E39182` | `.pt-banner--error` text |

`--error-ink` on `--error-soft` measures 5.4:1 in light and 6.0:1 in dark.

## Appendix B: file-by-file build order

| Step | File | Depends on |
|---|---|---|
| 1 | `tool/index.html` | this spec |
| 2 | `tool/styles.css` | v1 tokens, appendix A |
| 3 | `tool/app.js` | sections 2, 8, 9 |
| 4 | `tool/mode-walk.js` | `stages.json`, `disciplines.json`, sections 3.6 to 3.9 |
| 5 | `tool/mode-openings.js` | Mode A merged, `curated.json`, `feeds.json`, `PolicyFeeds`, sections 3.10 to 3.13 |
| 6 | `tool/mode-plan.js` | `PolicyTool.plan`, sections 3.14, 3.15 |
| 7 | `tool/print.css` | `#pt-print` from step 6, section 7.6 |

Steps 5 and 6 run against stub data shaped exactly as section 8.2 until the real files land.

## Appendix C: the 23 discipline ids

Fixed. `data/disciplines.json` is the source of truth for the records. These ids are what appears in `?d=`, in `pt-discipline` and on the plan, so they never change once shipped.

| Division | ids |
|---|---|
| Natural sciences | `math-stats-computing`, `physical-chemical`, `earth-environment`, `biology` |
| Engineering and technology | `civil-environmental-transport-eng`, `electrical-computer-eng`, `mechanical-industrial-aerospace-eng`, `chemical-materials-biotech-eng`, `biomedical-eng` |
| Medical, health and life sciences | `medicine-health` |
| Agricultural and veterinary sciences | `agriculture-food-veterinary` |
| Social sciences | `psychology`, `economics-business`, `education`, `sociology-anthropology-social-work`, `law`, `political-science-public-admin`, `geography-planning`, `media-communication-journalism` |
| Humanities and the arts | `history-classics-religion`, `languages-literature-linguistics`, `philosophy`, `fine-arts-design-architecture-film` |

An id in a URL that does not resolve is dropped silently and the tool renders as though no field were chosen. It is a link someone edited, not an error the reader caused.
