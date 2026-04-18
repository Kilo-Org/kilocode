#!/usr/bin/env python3
"""Routing validator -- checks provider config against the expected role
matrix and validates provider schema completeness."""
from __future__ import annotations

import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Resolve kit root from the location of this script (07_SCRIPTS -> parent)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
KIT_ROOT = SCRIPT_DIR.parent

CONFIG_PATH = KIT_ROOT / "09_CONFIG" / "providers.yaml"

# ---------------------------------------------------------------------------
# Expected role -> provider mapping
# ---------------------------------------------------------------------------
EXPECTED_ROLES: dict[str, str] = {
    "contract_writing": "claude",
    "architecture_review": "claude",
    "execution_worker": "minimax",
    "bulk_processing": "minimax",
    "fallback_case": "siliconflow",
    "local_private": "ollama",
}

# Every provider entry must have these fields
REQUIRED_PROVIDER_FIELDS = {"id", "name", "endpoint", "capabilities"}


def _load_yaml(path: Path) -> dict | None:
    """Try to load YAML; returns None on any failure."""
    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:
        return None
    try:
        text = path.read_text(encoding="utf-8")
        return yaml.safe_load(text) or {}
    except OSError:
        return None


def check_config_found() -> tuple[bool, dict | None]:
    """Return (found, parsed_data | None)."""
    if not CONFIG_PATH.exists():
        return False, None
    data = _load_yaml(CONFIG_PATH)
    if data is None:
        return True, None  # file exists but couldn't parse
    return True, data


def check_role_matrix(data: dict | None) -> dict:
    """Compare config role assignments against EXPECTED_ROLES.

    The YAML role_matrix can use two formats:
      - Simple:  role: provider_id
      - Nested:  role: { primary: provider_id, fallback: ... }

    We compare the *primary* provider in either case.
    """
    if data is None:
        return {
            "pass": False,
            "detail": "No config data available -- cannot validate roles",
            "expected": EXPECTED_ROLES,
        }

    roles_section = data.get("roles", data.get("role_matrix", {}))
    if not isinstance(roles_section, dict):
        return {
            "pass": False,
            "detail": "Config has no recognizable roles/role_matrix section",
            "expected": EXPECTED_ROLES,
        }

    mismatches: dict[str, dict[str, str]] = {}
    missing: list[str] = []
    for role, expected_provider in EXPECTED_ROLES.items():
        entry = roles_section.get(role)
        if entry is None:
            missing.append(role)
            continue

        # Normalise: if the entry is a dict with a "primary" key, use that
        if isinstance(entry, dict):
            actual = str(entry.get("primary", "")).lower()
        else:
            actual = str(entry).lower()

        if actual != expected_provider.lower():
            mismatches[role] = {"expected": expected_provider, "actual": actual}

    return {
        "pass": len(mismatches) == 0 and len(missing) == 0,
        "mismatches": mismatches,
        "missing_roles": missing,
    }


def check_provider_schema(data: dict | None) -> dict:
    """Validate that each provider entry has the required fields."""
    if data is None:
        return {"pass": False, "detail": "No config data available"}

    providers = data.get("providers", [])
    if not isinstance(providers, list):
        return {"pass": False, "detail": "'providers' key is not a list"}

    errors: dict[str, list[str]] = {}
    for idx, entry in enumerate(providers):
        if not isinstance(entry, dict):
            errors[f"entry_{idx}"] = ["not a mapping"]
            continue
        pid = entry.get("id", f"entry_{idx}")
        missing_fields = sorted(REQUIRED_PROVIDER_FIELDS - set(entry.keys()))
        if missing_fields:
            errors[str(pid)] = missing_fields

    return {
        "providers_checked": len(providers),
        "errors": errors,
        "pass": len(errors) == 0 and len(providers) > 0,
    }


def check_duplicates(data: dict | None) -> dict:
    """Check for duplicate provider IDs."""
    if data is None:
        return {"pass": False, "detail": "No config data available"}

    providers = data.get("providers", [])
    if not isinstance(providers, list):
        return {"pass": False, "detail": "'providers' key is not a list"}

    seen: dict[str, int] = {}
    for entry in providers:
        if isinstance(entry, dict):
            pid = entry.get("id", "<no-id>")
            seen[pid] = seen.get(pid, 0) + 1

    duplicates = {pid: count for pid, count in seen.items() if count > 1}
    return {
        "duplicates": duplicates,
        "pass": len(duplicates) == 0,
    }


def main() -> None:
    found, data = check_config_found()

    config_found_section: dict = {
        "path": str(CONFIG_PATH),
        "exists": found,
    }
    if not found:
        config_found_section["detail"] = (
            "config/providers.yaml not found. Create it at "
            f"{CONFIG_PATH} with roles and providers sections."
        )

    if found and data is None:
        config_found_section["detail"] = (
            "File exists but could not be parsed. "
            "Ensure PyYAML is installed (pip install pyyaml)."
        )

    role_matrix = check_role_matrix(data)
    provider_schema = check_provider_schema(data)
    duplicates = check_duplicates(data)

    # If config is missing we can't truly pass, but we don't hard-fail either
    if not found or data is None:
        verdict = "SKIP"
    else:
        verdict = "PASS" if all([
            role_matrix["pass"],
            provider_schema["pass"],
            duplicates["pass"],
        ]) else "FAIL"

    report = {
        "config_found": config_found_section,
        "role_matrix_check": role_matrix,
        "provider_schema_check": provider_schema,
        "duplicates": duplicates,
        "verdict": verdict,
    }

    print(json.dumps(report, indent=2))
    sys.exit(0 if verdict != "FAIL" else 1)


if __name__ == "__main__":
    main()
