# KiloCode Execution System

## Quick Start

1. **Read this file** - You're doing it
2. **Dispatch Agents 1-10** - `python agent_dispatcher.py --wave 1`
3. **Run Dashboard** - `python agent_monitor_dashboard.py`
4. **Wait 6 hours** - Let wave 1 work
5. **Dispatch Agents 11-20** - `python agent_dispatcher.py --wave 2`
6. **Wait 6 more hours**
7. **Run Integration** - `python agent_00_integration_lead.py`
8. **Generate Handoff** - `python generate_handoff.py`

## What Each Wave Does

### Wave 1 (Agents 1-10) - Immediate

| Agent | Name | Module | Status |
|-------|------|--------|--------|
| 1 | Audit Source Paths | agents.agent_01_source_audit | Pending |
| 2 | Audit Configs | agents.agent_02_config_audit | Pending |
| 3 | Audit Docs | agents.agent_03_doc_audit | Pending |
| 4 | Audit Tests | agents.agent_04_test_audit | Pending |
| 5 | Implement Runtime Core | agents.agent_05_runtime_impl | Pending |
| 6 | Implement Hermes Orchestrator | agents.agent_06_hermes_impl | Pending |
| 7 | Implement WebUI Panels | agents.agent_07_webui_impl | Pending |
| 8 | Implement ZeroClaw Adapters | agents.agent_08_zeroclaw_impl | Pending |
| 9 | Implement KiloCode Sync | agents.agent_09_kilocode_impl | Pending |
| 10 | Create Proof Module | agents.agent_10_proof_impl | Pending |

### Wave 2 (Agents 11-20) - After 6 hours

| Agent | Name | Module | Status |
|-------|------|--------|--------|
| 11 | Integration Testing | agents.agent_11_integration | Pending |
| 12 | Security Audit | agents.agent_12_security | Pending |
| 13 | Performance Optimization | agents.agent_13_performance | Pending |
| 14 | Documentation Review | agents.agent_14_doc_review | Pending |
| 15 | Config Validation | agents.agent_15_config_val | Pending |
| 16 | Test Coverage | agents.agent_16_coverage | Pending |
| 17 | Deployment Prep | agents.agent_17_deploy_prep | Pending |
| 18 | Monitoring Setup | agents.agent_18_monitoring | Pending |
| 19 | Backup Verification | agents.agent_19_backup | Pending |
| 20 | Final Review | agents.agent_20_review | Pending |

### Wave 3 (Integration Lead)

| Step | Action | Script |
|------|--------|--------|
| 1 | Verify all agents completed | agent_00_integration_lead.py |
| 2 | Run integration tests | agent_00_integration_lead.py |
| 3 | Verify component wiring | agent_00_integration_lead.py |
| 4 | Generate handoff document | generate_handoff.py |

## Monitoring

Dashboard: `python agent_monitor_dashboard.py`

Shows:
- Active agents with animated spinner
- Completion progress bar (ASCII art)
- Issues found counter with severity
- Blockers list with timestamps
- ETA to next wave
- Memory usage per agent
- Last heartbeat from each agent

## Architecture Overview

```
kilocode-Azure2/
├── START_HERE.md                    # This file
├── GAP_ANALYSIS.md                  # Source path references
├── agent_dispatcher.py              # Wave-based dispatcher
├── agent_monitor_dashboard.py      # Real-time monitoring
├── agent_00_integration_lead.py    # Integration verification
├── generate_handoff.py              # Handoff document generator
├── agents/                          # Agent implementations
│   ├── agent_01_source_audit.py
│   ├── agent_02_config_audit.py
│   ├── agent_03_doc_audit.py
│   ├── agent_04_test_audit.py
│   ├── agent_05_runtime_impl.py
│   ├── agent_06_hermes_impl.py
│   ├── agent_07_webui_impl.py
│   ├── agent_08_zeroclaw_impl.py
│   ├── agent_09_kilocode_impl.py
│   ├── agent_10_proof_impl.py
│   ├── agent_11_integration.py
│   ├── agent_12_security.py
│   ├── agent_13_performance.py
│   ├── agent_14_doc_review.py
│   ├── agent_15_config_val.py
│   ├── agent_16_coverage.py
│   ├── agent_17_deploy_prep.py
│   ├── agent_18_monitoring.py
│   ├── agent_19_backup.py
│   └── agent_20_review.py
├── state/                           # Agent state tracking
│   ├── wave_1_status.json
│   ├── wave_2_status.json
│   └── integration_status.json
├── output/                          # Agent outputs
└── logs/                            # Execution logs
```

## Timeline

| Hour | Event | Command |
|------|-------|---------|
| 0:00 | Start Wave 1 | `python agent_dispatcher.py --wave 1` |
| 0:00 | Run Dashboard | `python agent_monitor_dashboard.py` |
| 6:00 | Start Wave 2 | `python agent_dispatcher.py --wave 2` |
| 12:00 | Run Integration | `python agent_00_integration_lead.py` |
| 16:00 | Generate Handoff | `python generate_handoff.py` |
| 16:00+ | 95% Complete | Review KILOCODE_HANDOFF_FOR_WINDSURF.md |

## Requirements

- Python 3.10+
- Access to source paths in GAP_ANALYSIS.md
- 16 hours wall-clock time
- ~50GB disk space for outputs
- Network access for agent updates

## Agent State Machine

```
PENDING → RUNNING → COMPLETED
              ↓
           FAILED → RETRY → RUNNING
              ↓
           BLOCKED
```

## Output Artifacts

Each agent produces:
- `agents/output/agent_XX_*.json` - Structured results
- `agents/output/agent_XX_*.md` - Human-readable summary
- `agents/logs/agent_XX_*.log` - Execution log

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Agent stuck | Check `logs/agent_XX_stderr.log` |
| Dashboard frozen | Ctrl+C and restart |
| Wave 2 delayed | Safe to start manually later |
| Integration fails | Check individual agent outputs |

## Success Criteria

- [ ] All 20 agents complete successfully
- [ ] Integration tests pass
- [ ] Handoff document generated
- [ ] ZeroClaw adapters verified
- [ ] KiloCode sync operational
