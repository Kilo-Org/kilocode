#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import json

path = Path("configs/providers.yaml")
if not path.exists():
    print(json.dumps({"verdict": "FAIL", "reason": "configs/providers.yaml missing"}, indent=2))
    raise SystemExit(1)

text = path.read_text(encoding="utf-8")
checks = {
    "claude_defined": "claude:" in text,
    "minimax_defined": "minimax:" in text,
    "siliconflow_defined": "siliconflow:" in text,
    "ollama_defined": "ollama:" in text,
    "claude_planning_role": "role: planning" in text,
    "minimax_execution_role": "role: execution" in text,
}
verdict = "PASS" if all(checks.values()) else "FAIL"
print(json.dumps({"checks": checks, "verdict": verdict}, indent=2))
