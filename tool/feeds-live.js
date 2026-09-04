/*
 * tool/feeds-live.js
 *
 * Tier 1 of the freshness architecture: plain browser fetches, no server
 * in between, no dependencies. Exposes window.PolicyFeeds = { loadLive,
 * loadNews }. Both promises always resolve, never reject: loadLive puts a
 * failure's message in its returned errors array, loadNews falls back to
 * an empty array.
 *
 * loadLive() reads the Government of Canada consultations registry (CKAN
 * datastore, resource 92bec4b7-6feb-4215-a5f7-61da342b2354) with a bare
 * fetch(url), no headers at all. This host answers an OPTIONS preflight
 * with 403 and only puts Access-Control-Allow-Origin on a plain simple
 * GET, so adding any header (including Content-Type) breaks it. It sorts
 * end_date descending and paginates forward: standing engagements and
 * currently open items sort first, so the page (or few pages) that still
 * reads "current" is exactly the one worth keeping, and the scan can stop
 * the moment a page contains a record whose end_date has passed, since
 * everything after is older still. The status field is never trusted
 * (many records carry "open" long after their own end_date).
 *
 * loadNews(deptPaths) reads the canada.ca news ticker and filters it
 * client side to links whose path contains one of deptPaths, because the
 * API's own dept= filter does not work.
 *
 * Writes nothing; this file only reads.
 */
(function () {
  "use strict";

  var REGISTRY_HOST = "https://open.canada.ca";
  // CKAN's own _links.next comes back as "/api/3/action/..." with no
  // "/data" segment, even though the working host path is under /data.
  // Prefixing with REGISTRY_HOST alone 404s; verified live 2026-09-04.
  var REGISTRY_PREFIX = REGISTRY_HOST + "/data";
  var REGISTRY_RESOURCE = "92bec4b7-6feb-4215-a5f7-61da342b2354";
  var REGISTRY_START =
    REGISTRY_PREFIX +
    "/api/3/action/datastore_search?resource_id=" + REGISTRY_RESOURCE +
    "&sort=end_date%20desc&limit=100";
  var MAX_PAGES = 10;
  var STANDING_DAYS = 365;
  var SUBJECT_CODES_URL = "../data/subject_codes.json";
  var NEWS_URL = "https://api.io.canada.ca/io-server/gc/news/en/v2?sort=publishedDate&orderBy=desc&pick=30&format=json";

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function truncateWords(text, limit) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (words.length <= limit) return words.join(" ");
    return words.slice(0, limit).join(" ") + "...";
  }

  function daysBetween(isoLater, isoEarlier) {
    var later = Date.parse(isoLater);
    var earlier = Date.parse(isoEarlier);
    if (isNaN(later) || isNaN(earlier)) return NaN;
    return (later - earlier) / 86400000;
  }

  function fetchSubjectCodes() {
    return fetch(SUBJECT_CODES_URL)
      .then(function (resp) { return resp.ok ? resp.json() : { codes: {} }; })
      .then(function (doc) { return (doc && doc.codes) || {}; })
      .catch(function () { return {}; });
  }

  function domainsFor(subjects, codeMap) {
    var seen = {};
    var out = [];
    String(subjects || "").split(",").forEach(function (raw) {
      var entry = codeMap[raw.trim()];
      if (!entry || !entry.domains) return;
      entry.domains.forEach(function (domain) {
        if (!seen[domain]) {
          seen[domain] = true;
          out.push(domain);
        }
      });
    });
    return out;
  }

  function toOpening(record, codeMap, today) {
    var opens = (record.start_date || "").slice(0, 10) || null;
    var closes = (record.end_date || "").slice(0, 10) || null;
    var opening = {
      id: "consult-" + record.registration_number,
      title: record.title_en || "",
      body: truncateWords(record.description_en || "", 60),
      policyStage: 2,
      domains: domainsFor(record.subjects, codeMap),
      opens: opens,
      closes: closes,
      open_to: "anyone",
      source_url: record.profile_page_en || "",
      source_kind: "consultation",
      verified_on: today,
      expires_on: closes,
      tip: ""
    };
    var daysOut = closes ? daysBetween(closes, today) : NaN;
    if (!isNaN(daysOut) && daysOut > STANDING_DAYS) {
      opening.standing = true; // convenience only; not part of the shared Opening shape
    }
    return opening;
  }

  function fetchRegistryPage(url, today, codeMap, out, pageNumber) {
    return fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error("datastore_search HTTP " + resp.status);
      return resp.json();
    }).then(function (data) {
      var result = (data && data.result) || {};
      var records = result.records || [];
      var pageFullyCurrent = true;
      records.forEach(function (record) {
        var closes = (record.end_date || "").slice(0, 10);
        if (closes && closes >= today) {
          out.push(toOpening(record, codeMap, today));
        } else {
          pageFullyCurrent = false; // sorted end_date desc: everything after this is older still
        }
      });
      var next = result._links && result._links.next;
      if (pageFullyCurrent && next && pageNumber < MAX_PAGES) {
        return fetchRegistryPage(REGISTRY_PREFIX + next, today, codeMap, out, pageNumber + 1);
      }
    });
  }

  function loadLive() {
    var today = todayIso();
    var errors = [];
    var records = [];
    return fetchSubjectCodes().then(function (codeMap) {
      return fetchRegistryPage(REGISTRY_START, today, codeMap, records, 1);
    }).catch(function (err) {
      errors.push("consultations registry: " + (err && err.message ? err.message : String(err)));
    }).then(function () {
      records.sort(function (a, b) {
        var ca = a.closes || "";
        var cb = b.closes || "";
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      });
      return { records: records, fetched_at: new Date().toISOString(), errors: errors };
    });
  }

  function loadNews(deptPaths) {
    var paths = deptPaths || [];
    return fetch(NEWS_URL).then(function (resp) {
      if (!resp.ok) throw new Error("news HTTP " + resp.status);
      return resp.json();
    }).then(function (data) {
      var entries = (data && data.feed && data.feed.entry) || [];
      var items = entries.map(function (entry) {
        return {
          title: entry.title || "",
          link: entry.link || "",
          teaser: entry.teaser || "",
          publishedDate: entry.publishedDate || ""
        };
      });
      if (!paths.length) return items;
      return items.filter(function (item) {
        return paths.some(function (path) { return item.link.indexOf(path) !== -1; });
      });
    }).catch(function () {
      return [];
    });
  }

  window.PolicyFeeds = { loadLive: loadLive, loadNews: loadNews };
})();
