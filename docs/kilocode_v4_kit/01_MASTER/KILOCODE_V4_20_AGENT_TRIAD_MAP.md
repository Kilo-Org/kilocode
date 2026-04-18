# KiloCode v4 24-Agent Triad Map

## Global Control
1. **Program Director** — owns overall execution, breaks ties across subsystems
2. **Release Judge** — final pass/fail authority on every release gate
3. **Evidence Steward** — maintains truth matrix, defect ledger, and evidence bundles

## Architecture
4. **Architecture Owner** — defines subsystem boundaries, schemas, and data flow
5. **Architecture Confirmer** — verifies implementations match documented architecture
6. **Architecture Challenger** — stress-tests architecture decisions and boundary assumptions

## SSH / VPS
7. **SSH/VPS Owner** — owns tunnel lifecycle, key rotation, and VPS provisioning
8. **SSH/VPS Confirmer** — verifies connectivity, certificate validity, and config drift
9. **SSH/VPS Challenger** — attempts unauthorized access, tests failover and timeout paths

## ZeroClaw
10. **ZeroClaw Owner** — owns claw agent orchestration, scheduling, and state machine
11. **ZeroClaw Confirmer** — verifies task completion, output correctness, and idempotency
12. **ZeroClaw Challenger** — injects faults, races, and resource exhaustion into claw runs

## Provider Routing
13. **Routing Owner** — owns provider selection logic, fallback chains, and rate-limit handling
14. **Routing Confirmer** — verifies correct provider is selected for each model/context pair
15. **Routing Challenger** — simulates provider outages, quota exhaustion, and latency spikes

## Memory
16. **Memory Owner** — owns context persistence, retrieval indexing, and eviction policy
17. **Memory Confirmer** — verifies stored context is accurate, retrievable, and correctly scoped
18. **Memory Challenger** — tests memory corruption, stale recall, and cross-session leakage

## Training / GPU
19. **Training Owner** — owns fine-tuning pipelines, dataset curation, and checkpoint management
20. **Training Confirmer** — verifies training metrics, reproducibility, and artifact integrity
21. **Training Challenger** — tests overfitting detection, data poisoning, and resource limit edge cases

## Governance / Release
22. **Governance Owner** — owns compliance checks, policy enforcement, and audit trail
23. **QA/E2E Owner** — acts as confirmer; runs end-to-end acceptance suites across subsystems
24. **Governance Challenger** — tests policy bypasses, missing audit entries, and regulation edge cases

## Rule
No subsystem passes on owner sign-off alone.
At minimum:
- owner marks ready
- confirmer verifies evidence
- challenger fails to break critical path
