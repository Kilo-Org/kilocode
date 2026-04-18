#!/usr/bin/env python3
"""Truth validator -- checks that all truth files exist, parses their
contents, and reports on feature / defect / phase statistics."""
from __future__ import annotations

import csv
import io
import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Resolve kit root from the location of this script (07_SCRIPTS -> parent)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
KIT_ROOT = SCRIPT_DIR.parent

# ---------------------------------------------------------------------------
# Required truth files (relative to KIT_ROOT)
# ---------------------------------------------------------------------------
TRUTH_FILES: dict[str, Path] = {
    "RUNTIME_SOURCE_OF_TRUTH": KIT_ROOT / "02_TRUTH" / "KILOCODE_RUNTIME_SOURCE_OF_TRUTH.md",
    "FEATURE_TRUTH_MATRIX": KIT_ROOT / "02_TRUTH" / "FEATURE_TRUTH_MATRIX.md",
    "DEFECT_LEDGER": KIT_ROOT / "02_TRUTH" / "DEFECT_LEDGER.md",
}

PHASE_TRACKER_PATH = KIT_ROOT / "08_TRACKERS" / "PHASE_TRACKER.csv"


# ---- helpers ---------------------------------------------------------------

def _parse_md_table(text: str) -> list[dict[str, str]]:
    """Parse one or more Markdown tables in *text* into a flat list of
    row-dicts.

    Handles the standard format (possibly repeated per section):
        | H1 | H2 | ...
        |---|---|...
        | v1 | v2 | ...

    Separator lines and repeated header lines are excluded from the
    returned data rows.
    """
    pipe_lines = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("|")]
    if not pipe_lines:
        return []

    rows: list[dict[str, str]] = []
    headers: list[str] | None = None

    for ln in pipe_lines:
        # Skip separator lines (e.g. |---|---|)
        if all(c in "|-: " for c in ln):
            # The line right before a separator is a header -- capture it
            continue

        cells = [c.strip() for c in ln.strip("|").split("|")]

        # Detect header lines: they typically contain known column names.
        # We recognise a header when the first cell is a known header word
        # OR it matches the previous header exactly (repeated section).
        is_header = cells[0] in ("Feature", "ID", "Phase") if cells else False

        if is_header:
            headers = cells
            continue

        if headers is None:
            # First pipe-row before any separator -- treat as header
            headers = cells
            continue

        row = {headers[j]: cells[j] if j < len(cells) else "" for j in range(len(headers))}
        rows.append(row)

    return rows


# ---- section checks --------------------------------------------------------

def check_files() -> dict:
    """Check existence of each truth file."""
    details: dict[str, bool] = {}
    for label, path in TRUTH_FILES.items():
        details[label] = path.exists()
    return {
        "details": details,
        "pass": all(details.values()),
    }


def check_truth_matrix() -> dict:
    """Parse FEATURE_TRUTH_MATRIX.md and count rows by status."""
    path = TRUTH_FILES["FEATURE_TRUTH_MATRIX"]
    if not path.exists():
        return {"found": False, "pass": False, "detail": "file not found"}

    text = path.read_text(encoding="utf-8")
    rows = _parse_md_table(text)
    total = len(rows)
    if total == 0:
        return {"found": True, "total_rows": 0, "pass": False, "detail": "no data rows"}

    status_counts: dict[str, int] = {}
    for row in rows:
        status = row.get("Status", "Unknown").strip() or "Unknown"
        status_counts[status] = status_counts.get(status, 0) + 1

    return {
        "found": True,
        "total_rows": total,
        "status_counts": status_counts,
        "has_complete": status_counts.get("Complete", 0) > 0,
        "has_planned": status_counts.get("Planned", 0) > 0,
        "pass": total > 0,
    }


def check_defect_stats() -> dict:
    """Parse DEFECT_LEDGER.md and count open vs closed defects."""
    path = TRUTH_FILES["DEFECT_LEDGER"]
    if not path.exists():
        return {"found": False, "pass": False, "detail": "file not found"}

    text = path.read_text(encoding="utf-8")
    rows = _parse_md_table(text)
    total = len(rows)

    open_count = 0
    closed_count = 0
    other_count = 0
    for row in rows:
        status = row.get("Status", "").strip().lower()
        if status == "open":
            open_count += 1
        elif status in ("closed", "resolved", "fixed"):
            closed_count += 1
        else:
            other_count += 1

    return {
        "found": True,
        "total_defects": total,
        "open": open_count,
        "closed": closed_count,
        "other": other_count,
        "pass": True,  # ledger existing is sufficient
    }


def check_phase_stats() -> dict:
    """Parse PHASE_TRACKER.csv and count phases by status."""
    if not PHASE_TRACKER_PATH.exists():
        return {"found": False, "pass": False, "detail": "PHASE_TRACKER.csv not found"}

    text = PHASE_TRACKER_PATH.read_text(encoding="utf-8")
    reader = csv.DictReader(io.StringIO(text))
    status_counts: dict[str, int] = {}
    total = 0
    rows_raw: list[dict[str, str]] = []
    for row in reader:
        total += 1
        rows_raw.append(dict(row))
        status = (row.get("Status") or "Unknown").strip()
        status_counts[status] = status_counts.get(status, 0) + 1

    return {
        "found": True,
        "total_phases": total,
        "status_counts": status_counts,
        "pass": total > 0,
        "_rows": rows_raw,  # used internally, stripped before output
    }


def check_evidence(phase_rows: list[dict[str, str]]) -> dict:
    """For every phase marked Complete, verify that an EvidencePath value
    exists (non-empty). We do NOT check that the path actually resolves on
    disk -- only that the field is populated."""
    missing_evidence: list[str] = []
    checked = 0
    for row in phase_rows:
        status = (row.get("Status") or "").strip()
        if status == "Complete":
            checked += 1
            evidence = (row.get("EvidencePath") or "").strip()
            if not evidence:
                phase_id = row.get("Phase", "?")
                title = row.get("Title", "?")
                missing_evidence.append(f"Phase {phase_id}: {title}")

    return {
        "complete_phases_checked": checked,
        "missing_evidence": missing_evidence,
        "pass": len(missing_evidence) == 0,
    }


# ---- main ------------------------------------------------------------------

def main() -> None:
    files = check_files()
    truth_matrix_stats = check_truth_matrix()
    defect_stats = check_defect_stats()
    phase_result = check_phase_stats()

    # Extract raw rows for evidence check, then remove from output
    phase_rows = phase_result.pop("_rows", [])
    evidence = check_evidence(phase_rows)

    all_pass = all([
        files["pass"],
        truth_matrix_stats["pass"],
        defect_stats["pass"],
        phase_result["pass"],
        evidence["pass"],
    ])

    report = {
        "files": files,
        "truth_matrix_stats": truth_matrix_stats,
        "defect_stats": defect_stats,
        "phase_stats": phase_result,
        "evidence_check": evidence,
        "verdict": "PASS" if all_pass else "FAIL",
    }

    print(json.dumps(report, indent=2))
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
