#!/usr/bin/env python3
"""Extract the STAGES array out of index.html and write data/stages.json.

index.html carries the six policy stages as a JavaScript array literal
(STAGES) inside its one inline <script> block. Template strings in it
interpolate two constants, V (a "Verified" chip) and C (a "Check" chip).
This script isolates the STAGES literal, resolves it to plain Python data
with V and C substituted in, and writes:

    { "verified_on": "2026-09-03", "stages": [ ...six stage objects... ] }

Two resolution paths:

  1. Node (preferred, used whenever `node` is on PATH). The literal is
     handed to Node, evaluated inside a vm.createContext sandbox with V
     and C defined, and read back as JSON.stringify(STAGES): exact
     JavaScript semantics.
  2. Pure Python fallback, for a machine with no Node. A small tokenizer
     walks the literal (after substituting ${V} and ${C}, the only
     interpolations this array ever uses) and re-emits it as JSON:
     strings in any of the three JS quote styles become JSON strings,
     bare object keys get quoted, comments are stripped.

Drift check: the fresh extraction is always written to data/stages.json,
since that file should always reflect current index.html. But if a prior
data/stages.json existed and differs from the fresh extraction, that
means STAGES changed in index.html since the file was last generated;
this prints a unified diff and exits 1 so the change gets reviewed rather
than absorbed silently. No prior file, or one that already matches,
exits 0. Two runs back to back with index.html unchanged both exit 0.

Usage: python3 scripts/extract_stages.py
"""

import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = REPO_ROOT / "index.html"
OUT_PATH = REPO_ROOT / "data" / "stages.json"
VERIFIED_ON = "2026-09-03"  # the date v1's content was stamped, not "today"

START_MARKER = "const STAGES = ["
END_MARKER = "const LIVE = ["


def read_script_text():
    html = INDEX_HTML.read_text(encoding="utf-8")
    match = re.search(r"<script>(.*)</script>", html, re.S)
    if not match:
        raise SystemExit("extract_stages: no inline <script> block found in index.html")
    return match.group(1)


def extract_v_and_c(script):
    v_match = re.search(r"const V = '([^']*)';", script)
    c_match = re.search(r"const C = '([^']*)';", script)
    if not v_match or not c_match:
        raise SystemExit("extract_stages: could not find const V / const C in index.html")
    return v_match.group(1), c_match.group(1)


def extract_stages_literal(script):
    """Return the "[ ... ]" source text of the STAGES array, unparsed."""
    try:
        start = script.index(START_MARKER)
    except ValueError:
        raise SystemExit("extract_stages: 'const STAGES = [' not found in index.html")
    array_start = start + len("const STAGES = ")
    try:
        end = script.index(END_MARKER, array_start)
    except ValueError:
        raise SystemExit("extract_stages: 'const LIVE = [' not found after STAGES")
    literal = script[array_start:end].strip()
    if literal.endswith(";"):
        literal = literal[:-1].rstrip()
    if not (literal.startswith("[") and literal.endswith("]")):
        raise SystemExit("extract_stages: STAGES literal is not a bracketed array; index.html structure changed")
    return literal


# ---------------------------------------------------------------------------
# Path 1: Node, in a vm sandbox
# ---------------------------------------------------------------------------

NODE_DRIVER = """
const vm = require('vm');
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const sandbox = {};
vm.createContext(sandbox);
const wrapped = '(function(){\\n' + src + '\\n})()';
const result = vm.runInContext(wrapped, sandbox, { filename: 'stages-payload.js' });
process.stdout.write(result);
"""


def stages_via_node(literal, v_html, c_html):
    payload = (
        "const V = " + json.dumps(v_html) + ";\n"
        "const C = " + json.dumps(c_html) + ";\n"
        "const STAGES = " + literal + ";\n"
        "return JSON.stringify(STAGES);\n"
    )
    with tempfile.TemporaryDirectory() as tmp:
        driver_path = os.path.join(tmp, "driver.js")
        payload_path = os.path.join(tmp, "payload.js")
        Path(driver_path).write_text(NODE_DRIVER, encoding="utf-8")
        Path(payload_path).write_text(payload, encoding="utf-8")
        proc = subprocess.run(
            ["node", driver_path, payload_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
    if proc.returncode != 0:
        raise RuntimeError("node evaluation of STAGES failed: " + proc.stderr.strip())
    return json.loads(proc.stdout)


# ---------------------------------------------------------------------------
# Path 2: pure Python tokenizer fallback
# ---------------------------------------------------------------------------

ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", "'": "'", '"': '"', "`": "`"}


def tokenize_js(text):
    """Split a JS-literal fragment into (kind, value) tokens.

    kind is one of "str" (already unescaped), "ident", "num" or "punct"
    (one of the characters in "{}[]:," ). Whitespace and comments are
    dropped. Raises ValueError on anything this narrow grammar does not
    expect, since the input is a data literal, not general JavaScript.
    """
    tokens = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in " \t\r\n":
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j == -1 else j
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        if ch in "'\"`":
            quote = ch
            j = i + 1
            buf = []
            while j < n and text[j] != quote:
                if text[j] == "\\" and j + 1 < n:
                    buf.append(ESCAPES.get(text[j + 1], text[j + 1]))
                    j += 2
                else:
                    buf.append(text[j])
                    j += 1
            if j >= n:
                raise ValueError("unterminated string starting at offset %d" % i)
            tokens.append(("str", "".join(buf)))
            i = j + 1
            continue
        if ch in "{}[]:,":
            tokens.append(("punct", ch))
            i += 1
            continue
        m = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", text[i:])
        if m:
            tokens.append(("ident", m.group(0)))
            i += len(m.group(0))
            continue
        m = re.match(r"-?\d+(\.\d+)?", text[i:])
        if m:
            tokens.append(("num", m.group(0)))
            i += len(m.group(0))
            continue
        raise ValueError("unexpected character %r at offset %d" % (ch, i))
    return tokens


def tokens_to_json_text(tokens):
    out = []
    for idx, (kind, val) in enumerate(tokens):
        if kind in ("str", "ident"):
            # A bare identifier is only ever a key in this grammar (no bare
            # word appears anywhere except in key position), so both string
            # and identifier tokens become JSON string literals here.
            out.append(json.dumps(val))
        elif kind == "num":
            out.append(val)
        else:  # punct
            out.append(val)
    text = "".join(out)
    text = re.sub(r",(?=[}\]])", "", text)  # JSON has no trailing commas
    return text


def stages_via_python(literal, v_html, c_html):
    text = literal.replace("${V}", v_html).replace("${C}", c_html)
    tokens = tokenize_js(text)
    return json.loads(tokens_to_json_text(tokens))


# ---------------------------------------------------------------------------


def build_stages_doc():
    script = read_script_text()
    v_html, c_html = extract_v_and_c(script)
    literal = extract_stages_literal(script)
    if shutil.which("node"):
        stages = stages_via_node(literal, v_html, c_html)
    else:
        print("extract_stages: node not on PATH, using the Python fallback converter", file=sys.stderr)
        stages = stages_via_python(literal, v_html, c_html)
    if len(stages) != 6 or [s["id"] for s in stages] != [1, 2, 3, 4, 5, 6]:
        raise SystemExit("extract_stages: expected 6 stages with ids 1..6, got ids %r" % [s.get("id") for s in stages])
    return {"verified_on": VERIFIED_ON, "stages": stages}


def main():
    new_doc = build_stages_doc()
    new_text = json.dumps(new_doc, indent=2, ensure_ascii=False) + "\n"

    old_text = None
    if OUT_PATH.exists():
        old_text = OUT_PATH.read_text(encoding="utf-8")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(new_text, encoding="utf-8")

    if old_text is None:
        print("extract_stages: wrote %s (no prior file, nothing to diff)" % OUT_PATH)
        return 0

    if old_text == new_text:
        print("extract_stages: OK, data/stages.json matches a fresh extraction (drift check passed)")
        return 0

    diff = difflib.unified_diff(
        old_text.splitlines(keepends=True),
        new_text.splitlines(keepends=True),
        fromfile="data/stages.json (previous)",
        tofile="data/stages.json (fresh extraction)",
    )
    sys.stdout.writelines(diff)
    print(
        "\nextract_stages: STAGES content in index.html changed since data/stages.json "
        "was last generated. The file above has been rewritten to match; review the "
        "diff before committing.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
