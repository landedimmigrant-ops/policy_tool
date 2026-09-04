#!/usr/bin/env python3
"""Validate the JSON files under data/ against the tool's shared shapes.

  data/feeds.json     every record: required keys, policyStage 1..6,
                      source_kind and open_to from the fixed lists, every
                      domains entry one of the 18 fixed ids.
  data/curated.json   the same, plus verified_on and expires_on must be
                      present and not null. Skipped if absent (a different
                      engineer owns this file).
  data/stages.json    must exist with exactly six stages, ids 1..6.
  data/sitting.json   must exist with session, source_url, verified_on
                      and a sitting_weeks list of {start, end}.
  data/subject_codes.json  every code has a label and only fixed domains.
  data/tips.json      if present, every top-level key is a source_kind.
  data/disciplines.json    if present, every committee acronym (a bare
                      2-6 letter code; Senate committees are named, not
                      coded, and are not checked this way) resolves in
                      data/crosswalk.json, and every domain is fixed.
                      Skipped if absent.

With --links, also HEAD-checks a random sample of 15 source_urls (all of
them if fewer exist) pulled from feeds.json and curated.json, one second
apart, with a real User-Agent, expecting 2xx or 3xx.

Exits 1 with every problem listed on any failure. Prints a summary table
of counts on success.

Usage:
  python3 scripts/validate.py
  python3 scripts/validate.py --links
"""

import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

REQUIRED_OPENING_KEYS = [
    "id", "title", "body", "policyStage", "domains", "opens", "closes",
    "open_to", "source_url", "source_kind", "verified_on", "expires_on", "tip",
]
SOURCE_KINDS = {"consultation", "bill", "gazette", "tender", "committee", "funding", "appointment", "review"}
OPEN_TO_VALUES = {"anyone", "organisation", "parliamentarian"}
DOMAIN_IDS = {
    "health", "environment-climate", "energy-natural-resources", "agriculture-food",
    "fisheries-oceans", "science-research-innovation", "digital-data-privacy",
    "economy-finance-trade", "labour-skills-social", "education-youth",
    "immigration-multiculturalism", "justice-rights-security", "indigenous",
    "culture-heritage-media", "official-languages", "transport-infrastructure-housing",
    "international-defence", "governance-public-administration",
}
ACRONYM_PATTERN = re.compile(r"^[A-Z]{2,6}$")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


def load_json(path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def extract_records(doc):
    """feeds.json/curated.json may be a bare list or {"records": [...]}."""
    if isinstance(doc, list):
        return doc
    if isinstance(doc, dict) and isinstance(doc.get("records"), list):
        return doc["records"]
    return None


def check_opening(record, where, errors):
    if not isinstance(record, dict):
        errors.append("%s: a record is not a JSON object" % where)
        return
    label = "%s#%s" % (where, record.get("id", "?"))
    missing = [k for k in REQUIRED_OPENING_KEYS if k not in record]
    if missing:
        errors.append("%s: missing required key(s) %s" % (label, ", ".join(missing)))
        return
    stage = record["policyStage"]
    if not isinstance(stage, int) or isinstance(stage, bool) or not (1 <= stage <= 6):
        errors.append("%s: policyStage %r is not an integer 1..6" % (label, stage))
    if record["source_kind"] not in SOURCE_KINDS:
        errors.append("%s: source_kind %r is not one of %s" % (label, record["source_kind"], sorted(SOURCE_KINDS)))
    if record["open_to"] not in OPEN_TO_VALUES:
        errors.append("%s: open_to %r is not one of %s" % (label, record["open_to"], sorted(OPEN_TO_VALUES)))
    domains = record["domains"]
    if not isinstance(domains, list):
        errors.append("%s: domains is not a list" % label)
    else:
        for domain in domains:
            if domain not in DOMAIN_IDS:
                errors.append("%s: domain %r is not one of the 18 fixed ids" % (label, domain))


def check_feeds(errors, counts):
    path = DATA_DIR / "feeds.json"
    if not path.exists():
        errors.append("data/feeds.json: file not found")
        return []
    records = extract_records(load_json(path))
    if records is None:
        errors.append("data/feeds.json: expected a 'records' list")
        return []
    for rec in records:
        check_opening(rec, "feeds.json", errors)
    counts["feeds.json"] = len(records)
    return records


def check_curated(errors, counts):
    path = DATA_DIR / "curated.json"
    if not path.exists():
        counts["curated.json"] = None  # owned by another engineer, may not exist yet
        return []
    records = extract_records(load_json(path))
    if records is None:
        errors.append("data/curated.json: expected a list of records, or a 'records' list")
        return []
    for rec in records:
        check_opening(rec, "curated.json", errors)
        if isinstance(rec, dict):
            label = "curated.json#%s" % rec.get("id", "?")
            if rec.get("verified_on") is None:
                errors.append("%s: missing verified_on" % label)
            if rec.get("expires_on") is None:
                errors.append("%s: missing expires_on" % label)
    counts["curated.json"] = len(records)
    return records


def check_stages(errors, counts):
    path = DATA_DIR / "stages.json"
    if not path.exists():
        errors.append("data/stages.json: file not found")
        return
    stages = load_json(path).get("stages")
    if not isinstance(stages, list):
        errors.append("data/stages.json: 'stages' is not a list")
        return
    ids = sorted(s.get("id") for s in stages if isinstance(s, dict))
    if len(stages) != 6 or ids != [1, 2, 3, 4, 5, 6]:
        errors.append("data/stages.json: expected exactly six stages with ids 1..6, got ids %r" % (ids,))
    counts["stages.json"] = len(stages)


def check_sitting(errors, counts):
    path = DATA_DIR / "sitting.json"
    if not path.exists():
        errors.append("data/sitting.json: file not found")
        return
    doc = load_json(path)
    for key in ("session", "source_url", "verified_on", "sitting_weeks"):
        if key not in doc:
            errors.append("data/sitting.json: missing key '%s'" % key)
    weeks = doc.get("sitting_weeks") or []
    for i, week in enumerate(weeks):
        if not isinstance(week, dict) or "start" not in week or "end" not in week:
            errors.append("data/sitting.json: sitting_weeks[%d] missing start/end" % i)
        elif week["start"] > week["end"]:
            errors.append("data/sitting.json: sitting_weeks[%d] start %s is after end %s" % (i, week["start"], week["end"]))
    counts["sitting.json"] = len(weeks)


def check_subject_codes(errors, counts):
    path = DATA_DIR / "subject_codes.json"
    if not path.exists():
        errors.append("data/subject_codes.json: file not found")
        return
    codes = load_json(path).get("codes") or {}
    for code, info in codes.items():
        if not isinstance(info, dict) or "label" not in info:
            errors.append("data/subject_codes.json: code %s missing 'label'" % code)
            continue
        for domain in info.get("domains") or []:
            if domain not in DOMAIN_IDS:
                errors.append("data/subject_codes.json: code %s has domain %r outside the 18 ids" % (code, domain))
    counts["subject_codes.json"] = len(codes)


def check_tips(errors, counts):
    path = DATA_DIR / "tips.json"
    if not path.exists():
        counts["tips.json"] = None
        return
    doc = load_json(path)
    # Real shape landed as {"tips": {source_kind: {...}}}; also accept a bare
    # {source_kind: {...}} object in case that wrapper ever goes away.
    tips = doc.get("tips") if isinstance(doc, dict) and isinstance(doc.get("tips"), dict) else doc
    if not isinstance(tips, dict):
        errors.append("data/tips.json: expected an object keyed by source_kind, optionally wrapped in a 'tips' key")
        return
    for key in tips:
        if key not in SOURCE_KINDS:
            errors.append("data/tips.json: key %r is not one of %s" % (key, sorted(SOURCE_KINDS)))
    counts["tips.json"] = len(tips)


def load_crosswalk_acronyms():
    path = DATA_DIR / "crosswalk.json"
    if not path.exists():
        return None
    doc = load_json(path)
    # Real shape landed as {"committees": [{"acronym": ..., ...}]}; also
    # accept a bare list of the same row shape.
    if isinstance(doc, dict) and isinstance(doc.get("committees"), list):
        rows = doc["committees"]
    elif isinstance(doc, list):
        rows = doc
    else:
        rows = []
    return {row["acronym"] for row in rows if isinstance(row, dict) and row.get("acronym")}


def check_disciplines(errors, counts):
    path = DATA_DIR / "disciplines.json"
    if not path.exists():
        counts["disciplines.json"] = None  # owned by another engineer, may not exist yet
        return
    doc = load_json(path)
    records = doc if isinstance(doc, list) else doc.get("disciplines") if isinstance(doc, dict) else None
    if records is None:
        errors.append("data/disciplines.json: expected a list of records, or a 'disciplines' list")
        return
    crosswalk_acronyms = load_crosswalk_acronyms()
    if crosswalk_acronyms is None:
        errors.append("data/disciplines.json: present, but data/crosswalk.json was not found to check committees against")
        crosswalk_acronyms = set()
    for rec in records:
        if not isinstance(rec, dict):
            continue
        label = "disciplines.json#%s" % rec.get("id", rec.get("name", "?"))
        for committee in rec.get("committees") or []:
            # Senate committees are referenced by name, not an acronym, so
            # only a bare acronym-shaped entry is checked against the crosswalk.
            if ACRONYM_PATTERN.match(committee) and committee not in crosswalk_acronyms:
                errors.append("%s: committee acronym %r not found in crosswalk.json" % (label, committee))
        for domain in rec.get("domains") or []:
            if domain not in DOMAIN_IDS:
                errors.append("%s: domain %r is not one of the 18 fixed ids" % (label, domain))
    counts["disciplines.json"] = len(records)


def _status(url, method):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code


def check_links(urls, errors):
    sample = urls if len(urls) <= 15 else random.sample(urls, 15)
    print("checking %d source_url(s) with HEAD requests (GET fallback), 1 second apart..." % len(sample))
    for i, url in enumerate(sample):
        if i > 0:
            time.sleep(1)
        status = None
        try:
            status = _status(url, "HEAD")
            # Some hosts (sshrc-crsh.canada.ca among them) refuse HEAD with a
            # 403, 404 or 405 while the page itself is fine. Confirm with GET
            # before calling the link broken.
            if status in (403, 404, 405):
                status = _status(url, "GET")
        except Exception as exc:
            errors.append("link check: %s -> %s" % (url, exc))
            continue
        mark = "ok" if 200 <= status < 400 else "FAIL"
        print("  %s %d %s" % (mark, status, url))
        if not (200 <= status < 400):
            errors.append("link check: %s -> HTTP %d" % (url, status))


def main():
    links_mode = "--links" in sys.argv[1:]
    errors = []
    counts = {}

    feeds_records = check_feeds(errors, counts)
    curated_records = check_curated(errors, counts)
    check_stages(errors, counts)
    check_sitting(errors, counts)
    check_subject_codes(errors, counts)
    check_tips(errors, counts)
    check_disciplines(errors, counts)

    if links_mode:
        urls = [r["source_url"] for r in feeds_records + curated_records if isinstance(r, dict) and r.get("source_url")]
        if urls:
            check_links(urls, errors)
        else:
            print("--links: no source_url values found to check")

    if errors:
        print("VALIDATION FAILED (%d issue%s):" % (len(errors), "" if len(errors) == 1 else "s"))
        for err in errors:
            print(" - " + err)
        return 1

    print("Validation summary:")
    width = max((len(k) for k in counts), default=0)
    for name in sorted(counts):
        count = counts[name]
        shown = "skipped, not present yet" if count is None else "%d checked" % count
        print("  %-*s  %s" % (width, name, shown))
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
