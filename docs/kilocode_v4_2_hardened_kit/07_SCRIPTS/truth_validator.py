#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import json

required = [
    "02_TRUTH/KILOCODE_RUNTIME_SOURCE_OF_TRUTH.md",
    "02_TRUTH/FEATURE_TRUTH_MATRIX.md",
    "02_TRUTH/DEFECT_LEDGER.md",
    "08_TRACKERS/PHASE_TRACKER.csv",
]
missing = [p for p in required if not Path(p).exists()]

content_checks = {}
if not missing:
    tm = Path("02_TRUTH/FEATURE_TRUTH_MATRIX.md").read_text(encoding="utf-8")
    content_checks["has_ssh"] = "SSH connect" in tm
    content_checks["has_zeroclaw"] = "ZeroClaw submit job" in tm
    content_checks["has_speech"] = "Speech input/output" in tm
else:
    content_checks = {"skipped": True}

verdict = "PASS" if not missing and all(v is True for v in content_checks.values()) else "FAIL"
print(json.dumps({"missing": missing, "content_checks": content_checks, "verdict": verdict}, indent=2))
