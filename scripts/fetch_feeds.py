#!/usr/bin/env python3
"""Fetch the three tier-2 feeds and write data/feeds.json.

Sources, each wrapped so one failing source never kills the run:

  legisinfo   LEGISinfo bills RSS (parl.ca). Bills with activity in the
              last 120 days become source_kind "bill", policyStage 4.
  gazette     Canada Gazette Part I RSS. Issues from the last 90 days
              become source_kind "gazette", policyStage 4, with a 30-day
              comment window and a 70-day trade-affected expiry computed
              from the issue's publish date. Never send an Origin header
              to this host; it answers one with 403.
  canadabuys  CanadaBuys new-tender-notices CSV (daily file, not the
              7MB open-notices file). Filtered to research and advisory
              work: UNSPSC codes starting 81 or 86, or a research-ish
              keyword in the title. Becomes source_kind "tender",
              policyStage 2.

Every request carries a real browser User-Agent. Output is deterministic:
records are sorted by id, and built_at is the one clock read of the run,
reused as every source's fetched_at, so an unchanged upstream produces a
byte-identical file except for that one timestamp. Each source also
records a sha256 of its own records list, so the workflow can detect a
real content change without a full JSON diff.

Writes: data/feeds.json, shaped
    { "built_at", "sources": {name: {fetched_at, count, ok, error, hash}},
      "records": [Opening, ...] }

Usage: python3 scripts/fetch_feeds.py
"""

import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "feeds.json"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

LEGISINFO_URL = "https://www.parl.ca/legisinfo/en/bills/rss"
GAZETTE_URL = "https://gazette.gc.ca/rss/p1-eng.xml"
CANADABUYS_URL = "https://canadabuys.canada.ca/opendata/pub/newTenderNotice-nouvelAvisAppelOffres.csv"

LEGISINFO_DAYS = 120
GAZETTE_DAYS = 90
GAZETTE_COMMENT_DAYS = 30
GAZETTE_EXPIRY_DAYS = 70

# Ordered so a title's domains come out in the fixed 18-id order.
DOMAIN_KEYWORDS = [
    ("health", ["health", "medical assistance in dying", "hospital", "disease", "cancer", "mental health", "drug consumption", "opioid", "food allergy", "brain injur"]),
    ("environment-climate", ["climate", "environment", "pollution", "emissions", "clean coast", "flood and drought", "biodivers", "conservation", "wetland"]),
    ("energy-natural-resources", ["energy", "electricity", "pipeline", "mining", "mineral", "renewable", "nuclear", "oil and gas"]),
    ("agriculture-food", ["agricult", "farm", "food", "grocer", "livestock", "soil", "supply management"]),
    ("fisheries-oceans", ["fisher", "ocean", "marine", "coast guard", "shipping container", "vessel", "port"]),
    ("science-research-innovation", ["science", "research", "innovation", "space launch", "spectrum policy"]),
    ("digital-data-privacy", ["privacy", "data protection", "cyber", "digital", "online", "deepfake", "telecommunications", "artificial intelligence", "lawful access"]),
    ("economy-finance-trade", ["tax", "budget", "economic", "trade", "financial", "bank", "tariff", "customs", "insurance", "afford", "prosperity", "appropriation"]),
    ("labour-skills-social", ["labour", "employment", "worker", "pension", "basic income", "skilled trades", "replacement workers"]),
    ("education-youth", ["education", "student", "youth", "post-secondary"]),
    ("immigration-multiculturalism", ["immigrat", "citizenship", "refugee", "border", "multicultural"]),
    ("justice-rights-security", ["criminal code", "justice", "victim", "corrections", "parole", "sentenc", "judici", "human trafficking", "rcmp", "security", "terroris", "charter of rights", "prosecut"]),
    ("indigenous", ["indigenous", "indian act", "first nations", "metis", "métis", "inuit", "modern treaty"]),
    ("culture-heritage-media", ["heritage month", "heritage day", "arts", "culture", "broadcasting", "sport"]),
    ("official-languages", ["official languages", "francoph", "anglophone", "bilingual"]),
    ("transport-infrastructure-housing", ["housing", "transport", "railway", "aviation", "airport", "infrastructure", "highway"]),
    ("international-defence", ["defence", "defense", "military", "foreign affairs", "international", "veterans", "armed forces", "sanctions"]),
    ("governance-public-administration", ["election", "parliament", "senate", "governance", "public service", "oath of office", "constitution act", "access to information", "auditor general"]),
]

RESEARCH_KEYWORDS = re.compile(
    r"research|study|studies|evaluation|analysis|survey|assessment|consultation", re.I
)
BILL_TITLE_PATTERN = re.compile(r"^([A-Za-z]-\d+)\s*\(([^)]+)\)\s*-\s*(.+)$")
GAZETTE_SLUG_PATTERN = re.compile(r"/p1/\d{4}/([^/]+)/")


def infer_domains(text):
    """Domains whose keyword list has a hit in text, anchored at a word start.

    A plain substring test would match "sport" inside "transportation". Some
    keywords are deliberately word stems ("agricult" for agriculture,
    agricultural), so only the leading edge is anchored to a word boundary,
    not the trailing edge.
    """
    low = text.lower()
    hits = []
    for domain, keywords in DOMAIN_KEYWORDS:
        if any(re.search(r"\b" + re.escape(kw), low) for kw in keywords):
            hits.append(domain)
    return hits


def truncate_words(text, limit=60):
    text = re.sub(r"\s+", " ", text).strip()
    words = text.split(" ")
    if len(words) <= limit:
        return text
    return " ".join(words[:limit]) + "..."


def fetch_url(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def parse_feed_date(raw):
    dt = parsedate_to_datetime((raw or "").strip())
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def hash_records(records):
    blob = json.dumps(records, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def fetch_legisinfo(today):
    records = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=LEGISINFO_DAYS)
    data = fetch_url(LEGISINFO_URL)
    for item in ET.fromstring(data).findall(".//item"):
        title_raw = (item.findtext("title") or "").strip()
        match = BILL_TITLE_PATTERN.match(title_raw)
        if not match:
            continue
        number, _session, short_title = match.group(1), match.group(2), match.group(3).strip()
        pub_raw = item.findtext("pubDate")
        try:
            pub_dt = parse_feed_date(pub_raw)
        except (TypeError, ValueError):
            continue
        if pub_dt < cutoff:
            continue
        body = re.sub(r"^Latest activity:\s*", "", (item.findtext("description") or "").strip())
        records.append({
            "id": "bill-" + number.lower(),
            "title": "Bill %s: %s" % (number, short_title),
            "body": truncate_words(body),
            "policyStage": 4,
            "domains": infer_domains(short_title),
            "opens": pub_dt.date().isoformat(),
            "closes": None,
            "open_to": "anyone",
            "source_url": (item.findtext("link") or "").strip(),
            "source_kind": "bill",
            "verified_on": today,
            "expires_on": None,
            "tip": "",
        })
    return records


def fetch_gazette(today):
    records = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=GAZETTE_DAYS)
    data = fetch_url(GAZETTE_URL)  # no Origin header ever; this host 403s any request that carries one
    for item in ET.fromstring(data).findall(".//item"):
        pub_raw = item.findtext("pubDate")
        try:
            pub_dt = parse_feed_date(pub_raw)
        except (TypeError, ValueError):
            continue
        if pub_dt < cutoff:
            continue
        link = (item.findtext("link") or "").strip()
        slug_match = GAZETTE_SLUG_PATTERN.search(link)
        slug = slug_match.group(1) if slug_match else hashlib.sha1(link.encode()).hexdigest()[:10]
        opens = pub_dt.date()
        records.append({
            "id": "gazette-" + slug,
            "title": (item.findtext("title") or "").strip(),
            "body": (
                "Proposed regulations in this issue carry a 30-day comment window from "
                "publication, 70 days where trade is affected. Open the issue for the "
                "individual notices."
            ),
            "policyStage": 4,
            "domains": [],
            "opens": opens.isoformat(),
            "closes": (opens + timedelta(days=GAZETTE_COMMENT_DAYS)).isoformat(),
            "open_to": "anyone",
            "source_url": link,
            "source_kind": "gazette",
            "verified_on": today,
            "expires_on": (opens + timedelta(days=GAZETTE_EXPIRY_DAYS)).isoformat(),
            "tip": "",
        })
    return records


# Facility names carry "research" without the work being research: the
# Saskatoon Research and Development Centre needs plumbers too. Strip these
# phrases before the keyword test so a building name cannot qualify a tender.
FACILITY_PHRASES = re.compile(
    r"research\s+(?:and\s+development\s+)?(?:centre|center|station|farm|laboratory|lab|institute|facility|park)\b",
    re.IGNORECASE,
)


def research_title(title):
    """True when the title signals research or advisory work, ignoring facility names."""
    return bool(RESEARCH_KEYWORDS.search(FACILITY_PHRASES.sub(" ", title)))


def unspsc_codes(raw):
    return [code.strip().lstrip("*") for code in (raw or "").splitlines() if code.strip()]


def fetch_canadabuys(today):
    records = []
    data = fetch_url(CANADABUYS_URL)
    text = data.decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text, newline="")))
    survived = 0
    for row in rows:
        title = (row.get("title-titre-eng") or "").strip()
        if not title:
            continue
        codes = unspsc_codes(row.get("unspsc"))
        unspsc_hit = any(code.startswith("81") or code.startswith("86") for code in codes)
        if not (unspsc_hit or research_title(title)):
            continue
        survived += 1
        reference = (row.get("referenceNumber-numeroReference") or "").strip()
        notice_url = (row.get("noticeURL-URLavis-eng") or "").strip()
        if not notice_url and reference:
            # The CSV leaves this blank for most rows; CanadaBuys still serves
            # every notice at this permalink, confirmed live (200 for a real
            # reference, 404 for a made-up one).
            notice_url = "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/" + reference
        opens = (row.get("publicationDate-datePublication") or "").strip()[:10] or None
        closes = (row.get("tenderClosingDate-appelOffresDateCloture") or "").strip()[:10] or None
        description = (row.get("tenderDescription-descriptionAppelOffres-eng") or "").strip()
        if description:
            body = truncate_words(description)
        else:
            entity = (row.get("contractingEntityName-nomEntitContractante-eng") or "").strip() or "the listed department"
            notice_type = (row.get("noticeType-avisType-eng") or "").strip() or "Tender"
            body = truncate_words("%s from %s, closes %s." % (notice_type, entity, closes or "an unspecified date"))
        record_id = "tender-" + (reference.lower() or hashlib.sha1(title.encode()).hexdigest()[:10])
        records.append({
            "id": record_id,
            "title": title,
            "body": body,
            "policyStage": 2,
            "domains": infer_domains(title),
            "opens": opens,
            "closes": closes,
            "open_to": "organisation",
            "source_url": notice_url,
            "source_kind": "tender",
            "verified_on": today,
            "expires_on": closes,
            "tip": "",
        })
    print("canadabuys: %d of %d rows survive the research/advisory filter (UNSPSC 81/86, or a research keyword in the title)" % (survived, len(rows)))
    return records


def run_source(name, fetch_fn, run_stamp, today):
    try:
        records = fetch_fn(today)
        info = {"fetched_at": run_stamp, "count": len(records), "ok": True, "error": None, "hash": hash_records(records)}
    except Exception as exc:  # one source failing must never kill the run
        records = []
        info = {"fetched_at": run_stamp, "count": 0, "ok": False, "error": "%s: %s" % (type(exc).__name__, exc), "hash": hash_records([])}
    print("%s: ok=%s count=%d%s" % (name, info["ok"], info["count"], "" if info["ok"] else " error=%r" % info["error"]))
    return records, info


def main():
    run_stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    today = run_stamp[:10]  # the date each Opening's verified_on carries; fetched_at keeps the full stamp

    legisinfo_records, legisinfo_info = run_source("legisinfo", fetch_legisinfo, run_stamp, today)
    gazette_records, gazette_info = run_source("gazette", fetch_gazette, run_stamp, today)
    canadabuys_records, canadabuys_info = run_source("canadabuys", fetch_canadabuys, run_stamp, today)

    all_records = legisinfo_records + gazette_records + canadabuys_records
    all_records.sort(key=lambda r: r["id"])

    doc = {
        "built_at": run_stamp,
        "sources": {
            "legisinfo": legisinfo_info,
            "gazette": gazette_info,
            "canadabuys": canadabuys_info,
        },
        "records": all_records,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote %s: %d records total" % (OUT_PATH, len(all_records)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
