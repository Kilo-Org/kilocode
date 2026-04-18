#!/usr/bin/env python3
from __future__ import annotations
import os, shutil, json
from pathlib import Path

TOOLS = ["git", "gh", "lizard", "bandit"]
ENV_VARS = ["PATH"]
PATHS = ["configs", "02_TRUTH", "03_SPECS", "08_TRACKERS"]

def main():
    report = {
        "tools": {t: bool(shutil.which(t)) for t in TOOLS},
        "env": {e: bool(os.environ.get(e)) for e in ENV_VARS},
        "paths": {p: {"exists": Path(p).exists(), "is_dir": Path(p).is_dir()} for p in PATHS},
    }
    report["verdict"] = "PASS" if all(report["tools"].values()) and all(report["env"].values()) and all(v["exists"] for v in report["paths"].values()) else "FAIL"
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
