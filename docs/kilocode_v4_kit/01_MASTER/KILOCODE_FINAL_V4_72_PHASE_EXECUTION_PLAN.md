# KiloCode Final v4 72-Phase Execution Plan

## Block A — Truth, Inventory, and Operating Model (01–10)
01. Establish source-of-truth files
02. Create feature truth matrix
03. Create defect ledger
04. Create run ledger
05. Capture current-state capability inventory
06. Define architecture boundaries
07. Index config paths and env vars
08. Define evidence bundle layout
09. Define completion gates and hard-stop rules
10. Baseline drift scan

## Block B — User-Facing Operating Flows (11–16)
11. Define top 12 operator workflows
12. Risk-score workflows
13. Map approval requirements
14. Map provider requirements
15. Map memory requirements
16. Map execution substrate requirements

## Block C — SSH and Remote Systems (17–26)
17. SSH profile schema
18. SSH host groups and labels
19. Key management and validation flow
20. Jump-host support
21. Terminal tabs and reconnect
22. SFTP browser
23. Remote edit/save flow
24. Diff-before-save flow
25. Remote logs/transcript capture
26. Permission-denied and host-down failure paths

## Block D — VPS and Infra Operations (27–34)
27. VPS inventory model
28. CPU/RAM/disk panels
29. Service/process panels
30. Docker/Compose panels
31. Reverse proxy and app-service controls
32. Backup/restore runbooks
33. Deploy and rollback quick-actions
34. Incident and recovery flow

## Block E — ZeroClaw Integration (35–44)
35. Task intake schema
36. Execution risk levels
37. Hermes→ZeroClaw adapter contract
38. Workspace scope rules
39. Network policy rules
40. Low-risk auto path
41. Medium-risk buffered diff path
42. High-risk approval gate
43. Artifact/log/result return surfaces
44. Rollback/retry behavior

## Block F — Provider Routing (45–52)
45. Provider role matrix
46. Claude lane
47. MiniMax lane
48. SiliconFlow lane
49. Ollama / LM Studio local lane
50. Health and env validation
51. Wrong-role block/reroute
52. Cost/trace/fallback display

## Block G — Memory and Continuity (53–58)
53. Shiba connectivity status
54. Recall trace panel
55. Memory write history
56. Project-scoped memory model
57. Cross-agent recall workflow
58. Memory failure-path handling

## Block H — Training and GPU Orchestration (59–66)
59. Dataset registry
60. Dataset validation/preprocessing
61. Training job templates
62. Local vs remote GPU target selection
63. Job monitoring panels
64. Checkpoint resume/stop
65. Compare-runs workflow
66. Export/package workflow

## Block I — Governance, Release, Finalization (67–72)
67. Authority tiers
68. Approval modal + audit history
69. Dangerous action deny/gate rules
70. CI/CD, build, package, release, rollback panels
71. Adversarial final audit
72. Release verdict + packaging

## Required per phase
- claim
- changed files/components
- config/runtime references
- evidence path
- open defects
- owner verdict
- confirmer verdict
- challenger verdict
- final gate result

## Phase Dependencies
See [PHASE_DEPENDENCY_MAP.md](PHASE_DEPENDENCY_MAP.md) for the complete dependency graph.

## Critical Path
A (01-10) -> B (11-16) -> E (35-44) -> I (67-72)
