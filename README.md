# Federal Policy Pathways

Two things live here.

**The explainer**, at the site root (`index.html`). How a decision moves through the Canadian federal government in six policy stages, and where a researcher can get in. Each stage has two views: the machine (what happens, who is in the room, how long it takes) and your opening (routes ranked by leverage, what you need in hand, the rules with links, the mistake people make). Every factual claim carries a marker: **Verified** against the official page on the date shown, or **Check**, inferred from pattern.

**The tool**, at `tool/`. A prototype. Pick your situation or your field, walk the six policy stages re-ranked for that field, see what is open right now with a how-to-intervene tip on every item, and build a plan you can print as a one to two page brief. Everything you type stays in your browser. No accounts, no server.

Live at https://landedimmigrant-ops.github.io/policy_tool/

## How the openings stay current

Three tiers, one record shape, and every card shows when it was last checked.

| Tier | Source | How |
|---|---|---|
| Live | Government of Canada consultations registry (open.canada.ca) | Fetched in the browser on page load. Filtered on end date, never on the registry's status field, which is not maintained |
| Daily build | LEGISinfo bills, Canada Gazette Part I, CanadaBuys research tenders | A GitHub Actions workflow writes `data/feeds.json` every morning and commits only when records changed |
| Curated | Committee studies taking briefs, Tri-agency calls, advisory appointments, pre-budget windows | `data/curated.json`, each record with a checked-on date and an expiry. Expired items grey out and disappear after thirty days |

## Data files

| File | What it holds |
|---|---|
| `data/stages.json` | The six policy stages, extracted from `index.html` with a drift check |
| `data/situations.json` | Eight "what's your situation" cards, each routing to a policy stage |
| `data/disciplines.json` | 23 fields derived from the Canadian Research and Development Classification 2020, each with lead departments, committees, actors, ranked openings and route weights |
| `data/crosswalk.json` | House and Senate committees mapped to the departments they oversee and to subject domains. Assembled by hand from Standing Orders 104 and 108 and each committee's About page; no published table exists |
| `data/tips.json` | How to intervene, by kind of opening and policy stage |
| `data/curated.json` | Hand-curated openings with dates |
| `data/feeds.json` | Daily build output |
| `data/sitting.json` | House sitting weeks for the current session |
| `data/subject_codes.json` | The registry's 54 subject codes mapped to domains |
| `data/domains.json` | The 18 domain ids and labels |

Route weights and domain assignments are editorial judgement and are marked Check throughout.

## Run locally

```bash
python3 -m http.server 8750
```

Open http://localhost:8750/ for the explainer and http://localhost:8750/tool/ for the tool. The live consultations tier only loads from an `https` origin, so on localhost the board shows the daily build and the curated items and says so.

## Refresh the data

```bash
python3 scripts/fetch_feeds.py
python3 scripts/validate.py --links
python3 scripts/extract_stages.py
```

The workflow in `.github/workflows/feeds.yml` runs the first two daily. The third re-extracts the stages from `index.html` and fails if `data/stages.json` has drifted.

## Scope and status

Federal layer only. Quebec and other provinces to follow. Dated items go stale in weeks; the tool shows the check date on every one rather than hiding it.

Built for Pathways to Impact, Concordia University. A prototype: the feedback link in the masthead is the way to tell us what is missing.

## Sources

parliament.gc.ca, ourcommons.ca, sencanada.ca, canada.ca, open.canada.ca, gazette.gc.ca, canadabuys.canada.ca, science.gc.ca, pbo-dpb.ca, cca-reports.ca, oag-bvg.gc.ca, statcan.gc.ca (CRDC 2020).
