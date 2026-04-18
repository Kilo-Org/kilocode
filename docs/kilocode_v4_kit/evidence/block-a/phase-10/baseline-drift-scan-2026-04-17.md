# Baseline Drift Scan Report
Date: 2026-04-17
Phase: 10 -- Baseline Drift Scan

## Validation Script Results

### parity_check.py
**Verdict: FAIL**

```json
{
  "files": { "expected": 31, "found": 31, "missing": [], "pass": true },
  "manifest": {
    "found": true,
    "declared_count": 34,
    "actual_required": 31,
    "counts_match": false,
    "pass": false
  },
  "tracker": { "found": true, "expected_rows": 72, "actual_rows": 72, "pass": true },
  "truth_matrix": { "found": true, "total_lines": 112, "data_rows": 69, "pass": true },
  "tools": { "details": { "git": true, "gh": true, "python3": true, "bun": true }, "pass": true },
  "env": { "details": { "PATH": true, "HOME": true }, "pass": true },
  "verdict": "FAIL"
}
```

**Root cause:** MANIFEST.json declares `file_count: 34` and lists 34 entries, but the parity script's own required-files list contains 31 entries. Additionally, 7 files exist on disk that are not listed in the manifest, and the manifest lists `PHASE_DEPENDENCY_MAP.md` at root level when the actual file lives at `01_MASTER/PHASE_DEPENDENCY_MAP.md`. Net: 40 real files on disk vs 34 declared in the manifest.

Files on disk but missing from MANIFEST.json:
- `01_MASTER/PHASE_DEPENDENCY_MAP.md` (manifest has it at root level instead)
- `02_TRUTH/CAPABILITY_INVENTORY.md`
- `02_TRUTH/CONFIG_ENV_INDEX.md`
- `03_SPECS/ARCHITECTURE_BOUNDARIES.md`
- `03_SPECS/KILOCODE_SPEECH_COMPLETE_SPEC.md`
- `04_ENFORCEMENT/COMPLETION_GATES.md`
- `04_ENFORCEMENT/EVIDENCE_BUNDLE_LAYOUT.md`

### truth_validator.py
**Verdict: PASS**

```json
{
  "files": { "RUNTIME_SOURCE_OF_TRUTH": true, "FEATURE_TRUTH_MATRIX": true, "DEFECT_LEDGER": true, "pass": true },
  "truth_matrix_stats": { "total_rows": 69, "status_counts": { "Planned": 59, "Complete": 10 }, "pass": true },
  "defect_stats": { "total_defects": 5, "open": 3, "closed": 2, "pass": true },
  "phase_stats": { "total_phases": 72, "status_counts": { "Planned": 72 }, "pass": true },
  "evidence_check": { "complete_phases_checked": 0, "missing_evidence": [], "pass": true },
  "verdict": "PASS"
}
```

All truth documents present. 69 feature rows (10 Complete, 59 Planned). 5 defects tracked (3 open, 2 resolved). 72 phases tracked (all marked Planned in tracker CSV).

### routing_validator.py
**Verdict: FAIL**

```json
{
  "config_found": { "path": "09_CONFIG/providers.yaml", "exists": true },
  "role_matrix_check": {
    "pass": false,
    "mismatches": {},
    "missing_roles": ["execution_worker", "fallback_case"]
  },
  "provider_schema_check": { "providers_checked": 5, "errors": {}, "pass": true },
  "duplicates": { "duplicates": {}, "pass": true },
  "verdict": "FAIL"
}
```

**Root cause:** `providers.yaml` defines 5 providers but the routing validator expects roles `execution_worker` and `fallback_case` to be assigned. These roles are not mapped in the current config. No schema errors or duplicates detected.

## Spec-to-Code Drift Check

### Speech Subsystem (Complete)

| Spec Claim | Code Reality | Drift? |
|-----------|-------------|--------|
| 6 providers registered | 6 providers confirmed: browser, azure, google, openai, elevenlabs, polly. All implementation files exist at `webview-ui/src/utils/speech-providers/`. Registry at `webview-ui/src/data/speech-providers.ts` registers all 6. | No |
| CSP endpoints whitelisted | `src/webview-html-utils.ts` connect-src includes all 5 cloud endpoints: `*.tts.speech.microsoft.com`, `texttospeech.googleapis.com`, `api.openai.com`, `api.elevenlabs.io`, `polly.*.amazonaws.com`. Matches spec exactly. | No |
| 31 config keys | `package.json` contains exactly 31 keys under `kilo-code.new.speech.*`. Matches spec. | No |
| 95 unit tests | 4 test files found: `speech-provider-registry.test.ts` (5), `browser-provider.test.ts` (9), `azure-provider.test.ts` (11), `speech-text-filter.test.ts` (70). Total: 95 `it()` calls. Matches spec. | No |
| SpeechProvider interface shape | `webview-ui/src/types/voice.ts` exports interface matching spec: id, name, tier, requiresApiKey, description, freeAllowance, capabilities, getVoices(), synthesize(), stop(), testConnection?() | No |
| SpeechTab.tsx exists | `webview-ui/src/components/settings/SpeechTab.tsx` present (50 KB) | No |
| speech-playback.ts exists | `webview-ui/src/utils/speech-playback.ts` present (3.5 KB) | No |
| speech-text-filter.ts exists | `webview-ui/src/utils/speech-text-filter.ts` present | No |

**Speech subsystem drift: ZERO.** All spec claims verified against code.

### Other Subsystems (Planned)

| Subsystem | Spec Exists | Code Exists | Expected Drift |
|-----------|-------------|-------------|----------------|
| SSH/VPS | Yes (`03_SPECS/KILOCODE_SSH_VPS_COMPLETE_SPEC.md`) | No | Expected -- not yet built |
| ZeroClaw (Execution) | Yes (`03_SPECS/KILOCODE_ZEROCLAW_COMPLETE_SPEC.md`) | Partial (`src/commands/hermes.ts`, `src/services/hermes/` directory, `tests/unit/hermes-envelope.test.ts` with 12 tests) | Expected -- envelope/intake scaffolded only |
| Provider Routing | Yes (`03_SPECS/KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md`) | No (config in kit only) | Expected -- not yet built |
| Memory (Shiba) | Yes (`03_SPECS/KILOCODE_MEMORY_COMPLETE_SPEC.md`) | No | Expected -- not yet built |
| Training/GPU | Yes (`03_SPECS/KILOCODE_TRAINING_GPU_COMPLETE_SPEC.md`) | No | Expected -- not yet built |
| Governance/Release | Yes (`03_SPECS/KILOCODE_GOVERNANCE_RELEASE_COMPLETE_SPEC.md`) | No | Expected -- not yet built |

## Verdict

**CONDITIONAL PASS** with 2 non-blocking defects:

1. **MANIFEST.json is stale** -- declares 34 files but 40 exist on disk. Seven files added during phases 5-9 were never added to the manifest. The `PHASE_DEPENDENCY_MAP.md` path is wrong (root vs `01_MASTER/`). This caused parity_check.py to report FAIL despite all required files being present. **Remediation:** Update MANIFEST.json to list all 40 files with correct paths.

2. **routing_validator.py missing roles** -- `providers.yaml` does not assign `execution_worker` or `fallback_case` roles. These are required by the validator's role matrix. **Remediation:** Add role assignments in providers.yaml or update the validator expectations to match the current planning phase.

The core scan objective -- detecting drift between specs and code -- **passes cleanly**. The Speech subsystem (the only "Complete" subsystem) has zero drift across all 8 checked dimensions. All 6 planned-but-unbuilt subsystems have specs and no code, which is the expected state at this phase.

## Baseline Metrics

- **Kit files:** 40 on disk / 34 declared in MANIFEST.json (6 unlisted + 1 wrong path)
- **Truth matrix rows:** 69 total (10 Complete, 59 Planned)
  - Complete rows: all 10 in Speech subsystem
  - Planned rows: SSH/Remote (10), VPS/Infra (9), ZeroClaw (10), Provider Routing (9), Memory (6), Training/GPU (8), Governance (7)
- **Open defects:** 3 (D-001 Medium, D-003 Medium, D-004 High)
- **Closed defects:** 2 (D-002, D-005)
- **Phases complete:** 0 / 72 in PHASE_TRACKER.csv (all marked Planned; phases 1-9 work was done but tracker not updated)
- **Unit tests (speech):** 95 across 4 test files
- **Total unit test files in codebase:** 111
- **Validation scripts:** 3/3 run successfully (1 PASS, 2 FAIL with known causes)
- **Evidence directory structure:** Created with .gitkeep files for all 72 phases + release directory
- **Spec coverage:** 7 complete specs (SSH/VPS, ZeroClaw, Provider Routing, Memory, Training/GPU, Governance, Speech) + 1 architecture boundaries doc
