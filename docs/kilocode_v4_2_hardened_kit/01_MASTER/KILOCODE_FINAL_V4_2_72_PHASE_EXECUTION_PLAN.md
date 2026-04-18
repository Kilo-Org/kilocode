# KiloCode Final v4.2 Hardened 72-Phase Execution Plan

## Dependency legend
- `DependsOn` lists prerequisite phases that must pass first.
- `Unlock` is the concrete condition that allows the phase to begin.

### Phase 01 — Establish source-of-truth files
- Block: A
- DependsOn: None
- Unlock: Root truth docs exist and link to each other

### Phase 02 — Create feature truth matrix
- Block: A
- DependsOn: 01
- Unlock: Truth matrix exists with subsystem-linked rows

### Phase 03 — Create defect ledger
- Block: A
- DependsOn: 01
- Unlock: Defect ledger exists with severity model

### Phase 04 — Create run ledger
- Block: A
- DependsOn: 01
- Unlock: Run ledger path and format established

### Phase 05 — Capture current-state capability inventory
- Block: A
- DependsOn: 01
- Unlock: Current-vs-target matrix completed

### Phase 06 — Define architecture boundaries
- Block: A
- DependsOn: 01,05
- Unlock: Bot/Hermes/Kilo/ZeroClaw/provider boundaries explicit

### Phase 07 — Index config paths and env vars
- Block: A
- DependsOn: 01,05
- Unlock: Every required config/env variable documented

### Phase 08 — Define evidence bundle layout
- Block: A
- DependsOn: 01,03,04
- Unlock: Evidence schema and naming rules documented

### Phase 09 — Define completion gates and stop rules
- Block: A
- DependsOn: 01,02,03,08
- Unlock: Gate A-E and hard stop rules documented

### Phase 10 — Baseline drift scan
- Block: A
- DependsOn: 01,02,07,09
- Unlock: Baseline docs/config/runtime drift recorded

### Phase 11 — Define top 12 operator workflows
- Block: B
- DependsOn: 06,07
- Unlock: Core user journeys enumerated

### Phase 12 — Risk-score workflows
- Block: B
- DependsOn: 11
- Unlock: Workflow risk classes assigned

### Phase 13 — Map approval requirements
- Block: B
- DependsOn: 12
- Unlock: Approval decisions mapped per workflow

### Phase 14 — Map provider requirements
- Block: B
- DependsOn: 11
- Unlock: Provider lane required per workflow

### Phase 15 — Map memory requirements
- Block: B
- DependsOn: 11
- Unlock: Memory touchpoints mapped per workflow

### Phase 16 — Map execution substrate requirements
- Block: B
- DependsOn: 11,12
- Unlock: ZeroClaw need and execution type mapped

### Phase 17 — Design SSH profile schema
- Block: C
- DependsOn: 06,07
- Unlock: Profile schema documented and examples valid

### Phase 18 — Implement host groups and labels
- Block: C
- DependsOn: 17
- Unlock: Grouping metadata defined

### Phase 19 — Define key management and auth validation flow
- Block: C
- DependsOn: 17
- Unlock: Key/password/jump validation flow documented

### Phase 20 — Define jump-host support
- Block: C
- DependsOn: 17,19
- Unlock: Jump chain model documented

### Phase 21 — Define terminal tabs and reconnect behavior
- Block: C
- DependsOn: 17
- Unlock: Session lifecycle documented

### Phase 22 — Define SFTP browser model
- Block: C
- DependsOn: 17
- Unlock: Remote file browsing contract documented

### Phase 23 — Define remote edit/save flow
- Block: C
- DependsOn: 22
- Unlock: Edit-save-diff workflow documented

### Phase 24 — Define diff-before-save flow
- Block: C
- DependsOn: 23
- Unlock: Diff review contract documented

### Phase 25 — Define remote log/transcript capture
- Block: C
- DependsOn: 21
- Unlock: Transcript evidence format documented

### Phase 26 — Test SSH failure modes
- Block: C
- DependsOn: 19,21,22,25
- Unlock: Host-down/auth-fail/perm-denied scenarios documented

### Phase 27 — Design VPS inventory model
- Block: D
- DependsOn: 06,11
- Unlock: Inventory data model documented

### Phase 28 — Define CPU/RAM/disk panels
- Block: D
- DependsOn: 27
- Unlock: Metrics panel requirements documented

### Phase 29 — Define service/process panels
- Block: D
- DependsOn: 27
- Unlock: Service/process model documented

### Phase 30 — Define Docker/Compose panels
- Block: D
- DependsOn: 27
- Unlock: Container controls documented

### Phase 31 — Define reverse proxy and app-service controls
- Block: D
- DependsOn: 27,29
- Unlock: Nginx/Caddy/service controls documented

### Phase 32 — Define backup and restore runbooks
- Block: D
- DependsOn: 27
- Unlock: Backup/restore flows documented

### Phase 33 — Define deploy and rollback quick-actions
- Block: D
- DependsOn: 31,32
- Unlock: Deploy/rollback actions documented

### Phase 34 — Define incident and recovery flow
- Block: D
- DependsOn: 31,32,33
- Unlock: Incident response workflow documented

### Phase 35 — Define task intake schema
- Block: E
- DependsOn: 06,11,16
- Unlock: Task envelope schema documented

### Phase 36 — Define execution risk levels
- Block: E
- DependsOn: 12,35
- Unlock: Low/medium/high execution policies defined

### Phase 37 — Define Hermes→ZeroClaw adapter contract
- Block: E
- DependsOn: 35,36
- Unlock: Adapter request/response documented

### Phase 38 — Define workspace scope rules
- Block: E
- DependsOn: 35,36
- Unlock: Allowed workspace boundaries documented

### Phase 39 — Define network policy rules
- Block: E
- DependsOn: 35,36
- Unlock: Network allow/deny policy documented

### Phase 40 — Define low-risk auto path
- Block: E
- DependsOn: 36,38,39
- Unlock: Read-only auto-run flow documented

### Phase 41 — Define medium-risk buffered diff path
- Block: E
- DependsOn: 36,38,39
- Unlock: Buffered-write flow documented

### Phase 42 — Define high-risk approval gate
- Block: E
- DependsOn: 13,36,38,39
- Unlock: High-risk approval flow documented

### Phase 43 — Define artifact/log/result return surfaces
- Block: E
- DependsOn: 37,40,41,42
- Unlock: UI return path documented

### Phase 44 — Define rollback/retry behavior
- Block: E
- DependsOn: 37,41,42,43
- Unlock: Retry/rollback rules documented

### Phase 45 — Create provider role matrix
- Block: F
- DependsOn: 14
- Unlock: Provider role map documented

### Phase 46 — Define Claude lane
- Block: F
- DependsOn: 45
- Unlock: Contract/audit lane documented

### Phase 47 — Define MiniMax lane
- Block: F
- DependsOn: 45
- Unlock: Execution lane documented

### Phase 48 — Define SiliconFlow lane
- Block: F
- DependsOn: 45
- Unlock: Fallback/overflow lane documented

### Phase 49 — Define Ollama / LM Studio local lane
- Block: F
- DependsOn: 45
- Unlock: Local/private lane documented

### Phase 50 — Define health and env validation
- Block: F
- DependsOn: 07,45
- Unlock: Provider health and env checks documented

### Phase 51 — Define wrong-role block/reroute
- Block: F
- DependsOn: 45,50
- Unlock: Wrong-role behavior documented

### Phase 52 — Define cost/trace/fallback display
- Block: F
- DependsOn: 45,50,51
- Unlock: Route trace and cost visibility documented

### Phase 53 — Define Shiba connectivity status surface
- Block: G
- DependsOn: 15,07
- Unlock: Connectivity panel documented

### Phase 54 — Define recall trace panel
- Block: G
- DependsOn: 15,53
- Unlock: Recall trace UX and data contract documented

### Phase 55 — Define memory write history
- Block: G
- DependsOn: 15,53
- Unlock: Write-history UX and storage contract documented

### Phase 56 — Define project-scoped memory model
- Block: G
- DependsOn: 15,53
- Unlock: Project scope model documented

### Phase 57 — Define cross-agent recall workflow
- Block: G
- DependsOn: 15,54,55,56
- Unlock: Cross-agent recall path documented

### Phase 58 — Define memory failure-path handling
- Block: G
- DependsOn: 53,54,55,57
- Unlock: Memory failure paths documented

### Phase 59 — Define dataset registry
- Block: H
- DependsOn: 11,27
- Unlock: Dataset registry model documented

### Phase 60 — Define dataset validation/preprocessing
- Block: H
- DependsOn: 59
- Unlock: Validation/preprocess flow documented

### Phase 61 — Define training job templates
- Block: H
- DependsOn: 59,60
- Unlock: Training preset schema documented

### Phase 62 — Define local vs remote GPU target selection
- Block: H
- DependsOn: 27,61
- Unlock: Placement and target selection documented

### Phase 63 — Define job monitoring panels
- Block: H
- DependsOn: 61,62
- Unlock: Monitoring panel requirements documented

### Phase 64 — Define checkpoint resume/stop
- Block: H
- DependsOn: 61,63
- Unlock: Checkpoint control contract documented

### Phase 65 — Define compare-runs workflow
- Block: H
- DependsOn: 61,63,64
- Unlock: Compare-runs workflow documented

### Phase 66 — Define export/package workflow
- Block: H
- DependsOn: 61,65
- Unlock: Model/package export flow documented

### Phase 67 — Define speech subsystem surfaces
- Block: I
- DependsOn: 11,14,15
- Unlock: Speech input/output model documented

### Phase 68 — Define authority tiers
- Block: I
- DependsOn: 12,13
- Unlock: Authority tier model documented

### Phase 69 — Define approval modal and audit history
- Block: I
- DependsOn: 13,68
- Unlock: Approval/audit UI and logs documented

### Phase 70 — Define dangerous action deny/gate rules
- Block: I
- DependsOn: 12,13,36,68
- Unlock: Dangerous action rules documented

### Phase 71 — Define CI/CD, build, package, release, rollback panels
- Block: I
- DependsOn: 33,34,66,68,69,70
- Unlock: Release surfaces documented

### Phase 72 — Adversarial final audit and release verdict
- Block: I
- DependsOn: 01-71
- Unlock: Final cross-system review completed

