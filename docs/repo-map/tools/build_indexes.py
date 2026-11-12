"""Build the generated path and side-effect indexes for docs/repo-map.

Usage (from the repo root): python3 -I docs/repo-map/tools/build_indexes.py docs/repo-map
Reads 01-08 domain files, writes 10-path-index.md and 11-side-effects-by-class.md.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

root = Path(sys.argv[1])
domain_files = sorted(p for p in root.glob("0[1-8]-*.md"))

PATH_RE = re.compile(r"^#{3,4} (P-[A-Z]+-\d+)\b\s*[—–:-]?\s*(.*)$")
SE_RE = re.compile(r"^\| (SE-[A-Z]+-\d+) \|")


def anchor(heading: str) -> str:
    a = heading.strip().lower()
    a = re.sub(r"[^\w\- ]", "", a)
    return a.replace(" ", "-")


paths = []  # (domain_file, id, title, anchor)
effects = []  # dict rows
for f in domain_files:
    for line in f.read_text().splitlines():
        m = PATH_RE.match(line)
        if m:
            heading = line.lstrip("#").strip()
            paths.append((f.name, m.group(1), m.group(2).strip(), anchor(heading)))
            continue
        if SE_RE.match(line):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 6:
                continue
            se_id, trigger, cls, target, where, reversible = cells[:6]
            notes = " | ".join(cells[6:]).strip()
            effects.append(
                dict(file=f.name, id=se_id, trigger=trigger, cls=cls, target=target,
                     where=where, reversible=reversible, notes=notes)
            )

# Path index
out = ["# Path index", "",
       "Generated from the `P-*` headings in files 01-08. Do not edit by hand; "
       "regenerate after changing a domain file (see README).", "",
       f"{len(paths)} paths across {len(domain_files)} domain files.", ""]
by_file = defaultdict(list)
for p in paths:
    by_file[p[0]].append(p)
for fname in sorted(by_file):
    out += [f"## [{fname}]({fname})", "", "| ID | Path |", "|---|---|"]
    for _, pid, title, anc in by_file[fname]:
        out.append(f"| [{pid}]({fname}#{anc}) | {title.replace('|', '/')} |")
    out.append("")
(root / "10-path-index.md").write_text("\n".join(out) + "\n")

# Side effects by class
def base_classes(cls: str):
    found = set()
    splitter = r"[,;+]| and |/(?=(?:DB|FS|VEC|NET|PROC|WS|PUSH|ENV|CACHE|LOG|TEL|TIME)\b)"
    for part in re.split(splitter, cls.replace("`", "")):
        part = part.strip()
        if not part:
            continue
        base = part.split(":")[0].split(" ")[0].upper()
        found.add((base, part if base in ("NET", "OTHER") or base not in ORDER else base))
    return found or {("OTHER", "OTHER")}

ORDER = ["DB", "FS", "VEC", "NET", "PROC", "WS", "PUSH", "ENV", "CACHE", "LOG", "TEL", "TIME", "OTHER"]
grouped = defaultdict(list)
for e in effects:
    for base, label in base_classes(e["cls"]):
        grouped[base if base in ORDER else "OTHER"].append((label, e))

out = ["# Side effects by class", "",
       "Generated from the side-effect ledgers in files 01-08. Do not edit by hand; "
       "regenerate after changing a ledger (see README). A row with several classes "
       "appears under each.", "",
       f"{len(effects)} ledger rows.", "",
       "| Class | Rows |", "|---|---|"]
for c in ORDER:
    if grouped.get(c):
        out.append(f"| [{c}](#{c.lower()}) | {len(grouped[c])} |")
out.append("")
for c in ORDER:
    rows = grouped.get(c)
    if not rows:
        continue
    out += [f"## {c}", "", "| ID | Class | Target | Trigger | Where | Reversible? | Notes |",
            "|---|---|---|---|---|---|---|"]
    for label, e in sorted(rows, key=lambda r: (r[0], r[1]["file"], r[1]["id"])):
        out.append(
            f"| [{e['id']}]({e['file']}) | {label} | {e['target']} | {e['trigger']} | "
            f"{e['where']} | {e['reversible']} | {e['notes']} |"
        )
    out.append("")
(root / "11-side-effects-by-class.md").write_text("\n".join(out) + "\n")

print(f"paths={len(paths)} effects={len(effects)}")
for c in ORDER:
    if grouped.get(c):
        print(c, len(grouped[c]))
