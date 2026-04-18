# Phase Dependency Map

## Legend
- `->` means "unlocks" (must complete before the target can start)
- Phases within the same block can generally run in parallel unless noted
- Cross-block dependencies are marked explicitly

---

## Block A -- Truth & Inventory (01-10)
- Phase 01 (Source of truth) -> all other phases (foundation)
- Phase 02 (Feature truth matrix) -> Phase 71 (Adversarial audit)
- Phase 03 (Defect ledger) -> Phase 71 (Adversarial audit)
- Phase 04 (Run ledger) -> Phase 71 (Adversarial audit), Phase 68 (Approval audit history)
- Phase 05 (Capability inventory) -> Phase 11 (Top 12 workflows), Phase 45 (Provider role matrix)
- Phase 06 (Architecture boundaries) -> Blocks C, D, E, F, G, H (all implementation blocks)
- Phase 07 (Config paths and env vars) -> Phase 50 (Health and env validation), Phase 17 (SSH profile schema)
- Phase 08 (Evidence bundle layout) -> all evidence collection across every phase
- Phase 09 (Completion gates) -> all phase sign-offs and final gate results
- Phase 10 (Baseline drift scan) -> Phase 71 (Adversarial audit), Phase 02 (Truth matrix update baseline)

### Internal Block A ordering
- Phase 01 must be first (all others depend on it)
- Phases 02, 03, 04, 05 can run in parallel after 01
- Phase 06 depends on 05 (boundaries require inventory)
- Phase 07 depends on 06 (config paths scoped by boundaries)
- Phase 08 can run in parallel with 06-07
- Phase 09 depends on 08 (gates reference evidence layout)
- Phase 10 depends on 02 (drift scan checks against truth matrix)

## Block B -- User-Facing Operating Flows (11-16)
- Phase 11 (Top 12 workflows) -> Blocks C through I (workflows define what must be built)
- Phase 12 (Risk-score workflows) -> Phase 36 (Execution risk levels), Phase 42 (High-risk approval gate), Phase 69 (Dangerous action deny/gate rules)
- Phase 13 (Approval requirements) -> Phase 42 (High-risk approval gate), Phase 67 (Authority tiers), Phase 68 (Approval modal + audit history)
- Phase 14 (Provider requirements) -> Phase 45 (Provider role matrix), Phase 46-49 (Provider lanes)
- Phase 15 (Memory requirements) -> Phase 53 (Shiba connectivity), Phase 56 (Project-scoped memory)
- Phase 16 (Execution substrate requirements) -> Phase 35 (Task intake schema), Phase 37 (Hermes->ZeroClaw adapter), Phase 62 (GPU target selection)

### Internal Block B ordering
- Phase 11 must be first (all other flows reference the 12 workflows)
- Phases 12, 13, 14, 15, 16 can run in parallel after 11

## Block C -- SSH and Remote Systems (17-26)
- Phase 17 (SSH profile schema) -> Phase 18 (Host groups), Phase 19 (Key management)
- Phase 18 (Host groups and labels) -> Phase 20 (Jump-host support)
- Phase 19 (Key management and validation) -> Phase 20 (Jump-host support), Phase 26 (Permission-denied paths)
- Phase 20 (Jump-host support) -> Phase 21 (Terminal tabs and reconnect)
- Phase 21 (Terminal tabs and reconnect) -> Phase 22 (SFTP browser), Phase 25 (Remote logs/transcript)
- Phase 22 (SFTP browser) -> Phase 23 (Remote edit/save)
- Phase 23 (Remote edit/save) -> Phase 24 (Diff-before-save)
- Phase 24 (Diff-before-save) -> Phase 25 (Remote logs/transcript)
- Phase 25 (Remote logs/transcript) -> Phase 26 (Permission-denied and host-down paths)
- Phase 26 (Permission-denied and host-down) -> Block I (failure paths feed governance audit)

### Internal Block C ordering
- Strictly sequential: 17 -> 18 -> 19 -> 20 -> 21 -> 22 -> 23 -> 24 -> 25 -> 26
- However, 19 (key management) can start alongside 18 (host groups)
- 25 (logs) and 26 (failure paths) can start once 21 (terminal) is done

## Block D -- VPS and Infra Operations (27-34)
- Phase 27 (VPS inventory model) -> Phase 28-31 (all panels need inventory)
- Phase 28 (CPU/RAM/disk panels) -> Phase 34 (Incident and recovery)
- Phase 29 (Service/process panels) -> Phase 31 (Reverse proxy controls), Phase 34 (Incident flow)
- Phase 30 (Docker/Compose panels) -> Phase 33 (Deploy and rollback)
- Phase 31 (Reverse proxy and app-service) -> Phase 33 (Deploy and rollback)
- Phase 32 (Backup/restore runbooks) -> Phase 34 (Incident and recovery)
- Phase 33 (Deploy and rollback) -> Phase 34 (Incident and recovery), Phase 44 (Rollback/retry behavior)
- Phase 34 (Incident and recovery) -> Block I (incident data feeds governance audit)

### Internal Block D ordering
- Phase 27 must be first (inventory model)
- Phases 28, 29, 30 can run in parallel after 27
- Phase 31 depends on 29
- Phase 32 can run in parallel with 28-31
- Phase 33 depends on 30 and 31
- Phase 34 depends on 28, 29, 32, 33

## Block E -- ZeroClaw Integration (35-44)
- Phase 35 (Task intake schema) -> Phase 36 (Risk levels), Phase 37 (Hermes->ZeroClaw adapter)
- Phase 36 (Execution risk levels) -> Phase 40 (Low-risk auto path), Phase 41 (Medium-risk buffered diff), Phase 42 (High-risk approval gate)
- Phase 37 (Hermes->ZeroClaw adapter) -> Phase 38 (Workspace scope), Phase 39 (Network policy)
- Phase 38 (Workspace scope rules) -> Phase 40 (Low-risk auto path)
- Phase 39 (Network policy rules) -> Phase 40 (Low-risk auto path)
- Phase 40 (Low-risk auto path) -> Phase 41 (Medium-risk buffered diff)
- Phase 41 (Medium-risk buffered diff) -> Phase 42 (High-risk approval gate)
- Phase 42 (High-risk approval gate) -> Phase 43 (Artifact/log/result return)
- Phase 43 (Artifact/log/result return) -> Phase 44 (Rollback/retry behavior)
- Phase 44 (Rollback/retry behavior) -> Block I (rollback policies feed governance)

### Internal Block E ordering
- Phase 35 must be first (schema foundation)
- Phases 36 and 37 can run in parallel after 35
- Phases 38 and 39 can run in parallel after 37
- Phases 40, 41, 42 are strictly sequential (risk escalation chain)
- Phase 43 depends on 42
- Phase 44 depends on 43

## Block F -- Provider Routing (45-52)
- Phase 45 (Provider role matrix) -> Phase 46-49 (all provider lanes)
- Phase 46 (Claude lane) -> Phase 50 (Health and env validation), Phase 51 (Wrong-role block)
- Phase 47 (MiniMax lane) -> Phase 50 (Health and env validation), Phase 51 (Wrong-role block)
- Phase 48 (SiliconFlow lane) -> Phase 50 (Health and env validation), Phase 51 (Wrong-role block)
- Phase 49 (Ollama/LM Studio lane) -> Phase 50 (Health and env validation), Phase 51 (Wrong-role block)
- Phase 50 (Health and env validation) -> Phase 52 (Cost/trace/fallback display)
- Phase 51 (Wrong-role block/reroute) -> Phase 52 (Cost/trace/fallback display)
- Phase 52 (Cost/trace/fallback display) -> Block I (cost data feeds governance audit)

### Internal Block F ordering
- Phase 45 must be first (role matrix)
- Phases 46, 47, 48, 49 can run in parallel after 45
- Phases 50 and 51 can run in parallel after all lanes are done
- Phase 52 depends on 50 and 51

## Block G -- Memory and Continuity (53-58)
- Phase 53 (Shiba connectivity status) -> Phase 54 (Recall trace panel), Phase 55 (Memory write history)
- Phase 54 (Recall trace panel) -> Phase 57 (Cross-agent recall)
- Phase 55 (Memory write history) -> Phase 56 (Project-scoped memory)
- Phase 56 (Project-scoped memory) -> Phase 57 (Cross-agent recall)
- Phase 57 (Cross-agent recall) -> Phase 58 (Memory failure-path handling)
- Phase 58 (Memory failure-path handling) -> Block I (failure paths feed governance audit)

### Internal Block G ordering
- Phase 53 must be first (connectivity is the foundation)
- Phases 54 and 55 can run in parallel after 53
- Phase 56 depends on 55
- Phase 57 depends on 54 and 56
- Phase 58 depends on 57

## Block H -- Training and GPU Orchestration (59-66)
- Phase 59 (Dataset registry) -> Phase 60 (Dataset validation/preprocessing)
- Phase 60 (Dataset validation/preprocessing) -> Phase 61 (Training job templates)
- Phase 61 (Training job templates) -> Phase 62 (Local vs remote GPU selection), Phase 63 (Job monitoring)
- Phase 62 (Local vs remote GPU selection) -> Phase 63 (Job monitoring panels)
- Phase 63 (Job monitoring panels) -> Phase 64 (Checkpoint resume/stop)
- Phase 64 (Checkpoint resume/stop) -> Phase 65 (Compare-runs workflow)
- Phase 65 (Compare-runs workflow) -> Phase 66 (Export/package workflow)
- Phase 66 (Export/package workflow) -> Block I (packaged models feed governance/release)

### Internal Block H ordering
- Strictly sequential: 59 -> 60 -> 61 -> 62 -> 63 -> 64 -> 65 -> 66
- However, 62 (GPU selection) and 63 (monitoring) can start in parallel after 61
- 65 (compare runs) requires at least two completed training runs from 64

## Block I -- Governance, Release, Finalization (67-72)
- Phase 67 (Authority tiers) -> Phase 68 (Approval modal), Phase 69 (Dangerous action rules)
- Phase 68 (Approval modal + audit history) -> Phase 69 (Dangerous action deny/gate)
- Phase 69 (Dangerous action deny/gate) -> Phase 70 (CI/CD, build, package, release, rollback)
- Phase 70 (CI/CD and release panels) -> Phase 71 (Adversarial final audit)
- Phase 71 (Adversarial final audit) -> Phase 72 (Release verdict + packaging)
- Phase 72 (Release verdict + packaging) -> DONE

### Internal Block I ordering
- Strictly sequential: 67 -> 68 -> 69 -> 70 -> 71 -> 72
- Phase 71 requires ALL other blocks to be complete (full-system audit)
- Phase 72 cannot start until Phase 71 passes

---

## Cross-Block Dependencies

| Source Phase | Target Phase | Reason |
|-------------|-------------|--------|
| 06 (Architecture boundaries) | 17 (SSH profile schema) | SSH schema must respect architecture boundaries |
| 06 (Architecture boundaries) | 27 (VPS inventory model) | VPS model must align with architecture layers |
| 06 (Architecture boundaries) | 35 (ZeroClaw task intake) | Task intake schema must respect architecture boundaries |
| 07 (Config paths) | 50 (Health and env validation) | Env validation references config paths index |
| 07 (Config paths) | 17 (SSH profile schema) | SSH profiles stored at indexed config paths |
| 11 (Top 12 workflows) | 35 (Task intake schema) | Task intake must cover all defined workflows |
| 12 (Risk scoring) | 36 (Execution risk levels) | Risk scoring model feeds execution risk levels |
| 12 (Risk scoring) | 69 (Dangerous action rules) | Risk scores define what counts as dangerous |
| 13 (Approval requirements) | 42 (High-risk gate) | Approval map defines who can approve high-risk actions |
| 13 (Approval requirements) | 67 (Authority tiers) | Approval requirements feed authority tier definitions |
| 14 (Provider requirements) | 45 (Provider role matrix) | Provider needs map drives the role matrix |
| 15 (Memory requirements) | 53 (Shiba connectivity) | Memory needs map defines connectivity expectations |
| 16 (Execution substrate) | 62 (GPU target selection) | Substrate requirements define available GPU targets |
| 26 (SSH failure paths) | 58 (Memory failure-path) | Remote failure patterns inform memory failure handling |
| 33 (Deploy and rollback) | 44 (Rollback/retry behavior) | Deploy rollback patterns feed ZeroClaw rollback design |
| 37 (Hermes->ZeroClaw adapter) | 52 (Cost/trace display) | Adapter trace format must match cost/trace display expectations |
| 44 (Rollback/retry behavior) | 70 (CI/CD and release) | Rollback behavior informs release rollback procedures |
| 52 (Cost/trace display) | 71 (Adversarial audit) | Cost and trace data is reviewed during adversarial audit |
| 56 (Project-scoped memory) | 65 (Compare-runs workflow) | Run comparison draws on project-scoped memory for history |
| 58 (Memory failure-path) | 71 (Adversarial audit) | Memory failures are attack surface for adversarial audit |
| 66 (Export/package workflow) | 70 (CI/CD and release) | Exported model packages feed into release pipeline |

---

## Parallelization Opportunities

- **Blocks C (SSH) and D (VPS)** can run in parallel after Block A + B complete.
  Both are infrastructure blocks with no mutual dependencies.

- **Blocks F (Routing) and G (Memory)** can run in parallel after Block A + B complete.
  Provider routing and memory systems are independent subsystems.

- **Block H (Training)** can start after Block F completes.
  Training jobs need provider routing to select GPU targets and route to execution providers.

- **Blocks C + D and F + G** can all run in parallel with each other.
  Four blocks running concurrently is the maximum useful parallelism.

- **Block E (ZeroClaw)** can run in parallel with Blocks C + D, but depends on Block B
  (specifically Phases 12 and 16 for risk scoring and substrate requirements).

- **Block I (Governance)** requires all other blocks to be substantially complete.
  The adversarial audit (Phase 71) reviews the entire system.

---

## Critical Path

The minimum sequential chain that determines total project duration:

```
A (01-10) -> B (11-16) -> E (35-44) -> I (67-72)
```

Everything else can be parallelized around this critical path:

```
                        +-> C (17-26) --------+
                        |                      |
A (01-10) -> B (11-16) -+-> D (27-34) --------+-> I (67-72)
                        |                      |
                        +-> E (35-44) ---------+
                        |                      |
                        +-> F (45-52) -> H (59-66) -+
                        |                      |
                        +-> G (53-58) --------+
```

### Why E is on the critical path
ZeroClaw integration (Block E) has the longest internal chain (10 phases, mostly sequential
through the risk escalation ladder 40 -> 41 -> 42) and feeds directly into governance
controls that Block I requires. Blocks C, D, F, G, and H have more internal parallelism
or fewer phases, so they complete faster when run alongside E.

### Estimated parallelism savings
- Sequential execution of all 72 phases: 72 units of work
- With full parallelization: approximately 38-42 units of work (the critical path length)
- Savings: roughly 40-45% reduction in total elapsed time
