#!/usr/bin/env python3
"""Kit parity checker -- validates that every required file, tool, and
env-var is present and that MANIFEST.json / PHASE_TRACKER.csv are consistent."""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Resolve kit root from the location of this script (07_SCRIPTS -> parent)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
KIT_ROOT = SCRIPT_DIR.parent

# ---------------------------------------------------------------------------
# Every file the kit must contain, relative to KIT_ROOT
# ---------------------------------------------------------------------------
REQUIRED_FILES: list[str] = [
    # root
    "MANIFEST.json",
    "README.md",
    # 01_MASTER
    "01_MASTER/KILOCODE_FINAL_V4_MASTER_CONTRACT.md",
    "01_MASTER/KILOCODE_FINAL_V4_72_PHASE_EXECUTION_PLAN.md",
    "01_MASTER/KILOCODE_V4_20_AGENT_TRIAD_MAP.md",
    "01_MASTER/DEFECT_TRIBUNAL_SYSTEM.md",
    "01_MASTER/PHASE_DEPENDENCY_MAP.md",
    # 02_TRUTH
    "02_TRUTH/KILOCODE_RUNTIME_SOURCE_OF_TRUTH.md",
    "02_TRUTH/FEATURE_TRUTH_MATRIX.md",
    "02_TRUTH/DEFECT_LEDGER.md",
    # 03_SPECS
    "03_SPECS/KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md",
    "03_SPECS/KILOCODE_SSH_VPS_COMPLETE_SPEC.md",
    "03_SPECS/KILOCODE_ZEROCLAW_COMPLETE_SPEC.md",
    "03_SPECS/KILOCODE_MEMORY_COMPLETE_SPEC.md",
    "03_SPECS/KILOCODE_TRAINING_GPU_COMPLETE_SPEC.md",
    "03_SPECS/KILOCODE_GOVERNANCE_RELEASE_COMPLETE_SPEC.md",
    "03_SPECS/KILOCODE_SPEECH_COMPLETE_SPEC.md",
    # 04_ENFORCEMENT
    "04_ENFORCEMENT/NO_FAKE_COMPLETION_AND_NO_DRIFT_RULES.md",
    "04_ENFORCEMENT/OPERATOR_RUNBOOK.md",
    "04_ENFORCEMENT/ACCEPTANCE_REPORT_TEMPLATE.md",
    "04_ENFORCEMENT/RELEASE_VERDICT_TEMPLATE.md",
    # 05_TEMPLATES
    "05_TEMPLATES/TASK_INTAKE_TEMPLATE.md",
    "05_TEMPLATES/RUN_LEDGER_EXAMPLE.jsonl",
    # 06_DIAGRAMS
    "06_DIAGRAMS/kilocode_v4_architecture.svg",
    "06_DIAGRAMS/kilocode_v4_phase_flow.svg",
    # 07_SCRIPTS
    "07_SCRIPTS/parity_check.py",
    "07_SCRIPTS/routing_validator.py",
    "07_SCRIPTS/truth_validator.py",
    # 08_TRACKERS
    "08_TRACKERS/PHASE_TRACKER.csv",
    # 09_CONFIG
    "09_CONFIG/providers.yaml",
    "09_CONFIG/ssh_profiles.yaml",
]

EXPECTED_TRACKER_ROWS = 72
REQUIRED_TOOLS = ["git", "gh", "python3", "bun"]
REQUIRED_ENV_VARS = ["PATH", "HOME"]


def check_files() -> dict:
    """Return per-file existence info and overall pass/fail."""
    results: dict[str, bool] = {}
    for rel in REQUIRED_FILES:
        results[rel] = (KIT_ROOT / rel).exists()
    return {
        "expected": len(REQUIRED_FILES),
        "found": sum(results.values()),
        "missing": [k for k, v in results.items() if not v],
        "pass": all(results.values()),
    }


def check_manifest() -> dict:
    """Verify MANIFEST.json file_count matches the actual file count."""
    manifest_path = KIT_ROOT / "MANIFEST.json"
    if not manifest_path.exists():
        return {"found": False, "pass": False, "detail": "MANIFEST.json not found"}
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return {"found": True, "pass": False, "detail": f"parse error: {exc}"}

    declared = data.get("file_count")
    actual = len(REQUIRED_FILES)
    return {
        "found": True,
        "declared_count": declared,
        "actual_required": actual,
        "counts_match": declared == actual,
        "pass": declared == actual,
    }


def check_tracker() -> dict:
    """Verify PHASE_TRACKER.csv has the expected number of data rows."""
    tracker_path = KIT_ROOT / "08_TRACKERS" / "PHASE_TRACKER.csv"
    if not tracker_path.exists():
        return {"found": False, "pass": False, "detail": "PHASE_TRACKER.csv not found"}
    lines = tracker_path.read_text(encoding="utf-8").strip().splitlines()
    # first line is the header
    data_rows = len(lines) - 1 if len(lines) > 0 else 0
    return {
        "found": True,
        "expected_rows": EXPECTED_TRACKER_ROWS,
        "actual_rows": data_rows,
        "pass": data_rows == EXPECTED_TRACKER_ROWS,
    }


def check_truth_matrix() -> dict:
    """Verify FEATURE_TRUTH_MATRIX.md has more than just a header."""
    path = KIT_ROOT / "02_TRUTH" / "FEATURE_TRUTH_MATRIX.md"
    if not path.exists():
        return {"found": False, "pass": False, "detail": "FEATURE_TRUTH_MATRIX.md not found"}
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    # Count table data rows: pipe-lines that are neither separators nor headers.
    # Headers are lines whose first cell is a known header word (e.g. "Feature").
    data_rows = 0
    for ln in lines:
        stripped = ln.strip()
        if not stripped.startswith("|"):
            continue
        # Skip separator lines
        if all(c in "|-: " for c in stripped):
            continue
        # Skip header lines (first cell is a known header word)
        first_cell = stripped.strip("|").split("|")[0].strip()
        if first_cell in ("Feature", "ID", "Phase"):
            continue
        data_rows += 1
    return {
        "found": True,
        "total_lines": len(lines),
        "data_rows": data_rows,
        "pass": data_rows > 0,
    }


def check_tools() -> dict:
    """Check that required CLI tools are on PATH."""
    results: dict[str, bool] = {}
    for tool in REQUIRED_TOOLS:
        # On Windows, python3 may not exist; accept python as equivalent
        if tool == "python3" and not shutil.which("python3"):
            results[tool] = bool(shutil.which("python"))
        else:
            results[tool] = bool(shutil.which(tool))
    return {
        "details": results,
        "pass": all(results.values()),
    }


def check_env() -> dict:
    """Check that required environment variables are set."""
    results: dict[str, bool] = {}
    for var in REQUIRED_ENV_VARS:
        # On Windows HOME may not be set; accept USERPROFILE as equivalent
        if var == "HOME" and not os.environ.get("HOME"):
            results[var] = bool(os.environ.get("USERPROFILE"))
        else:
            results[var] = bool(os.environ.get(var))
    return {
        "details": results,
        "pass": all(results.values()),
    }


def main() -> None:
    files = check_files()
    manifest = check_manifest()
    tracker = check_tracker()
    truth_matrix = check_truth_matrix()
    tools = check_tools()
    env = check_env()

    all_pass = all([
        files["pass"],
        manifest["pass"],
        tracker["pass"],
        truth_matrix["pass"],
        tools["pass"],
        env["pass"],
    ])

    report = {
        "files": files,
        "manifest": manifest,
        "tracker": tracker,
        "truth_matrix": truth_matrix,
        "tools": tools,
        "env": env,
        "verdict": "PASS" if all_pass else "FAIL",
    }

    print(json.dumps(report, indent=2))
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
