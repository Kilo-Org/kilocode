# KiloCode v4.2 Hardened Balanced Agent Map

## Rule
Every critical subsystem has Owner + Confirmer + Challenger coverage.
Global roles sit above subsystem triads.

## Global roles
1. Program Director
2. Evidence Steward
3. Release Judge

## Subsystem triads
### Architecture
4. Architecture Owner
5. Architecture Confirmer
6. Architecture Challenger

### SSH / VPS
7. SSH/VPS Owner
8. SSH/VPS Confirmer
9. SSH/VPS Challenger

### ZeroClaw
10. ZeroClaw Owner
11. ZeroClaw Confirmer
12. ZeroClaw Challenger

### Provider Routing
13. Routing Owner
14. Routing Confirmer
15. Routing Challenger

### Memory / Shiba
16. Memory Owner
17. Memory Confirmer
18. Memory Challenger

### Training / GPU
19. Training Owner
20. Training Confirmer
21. Training Challenger
22. GPU/Compute Owner
23. GPU/Compute Confirmer
24. GPU/Compute Challenger

### Governance / Release / Speech
25. Governance Owner
26. Governance Confirmer
27. Governance Challenger
28. DevOps/Release Owner
29. DevOps/Release Confirmer
30. DevOps/Release Challenger
31. Speech Owner
32. Speech Confirmer
33. Speech Challenger

### UX / QA
34. UI/UX Owner
35. UI/UX Confirmer
36. QA/E2E Challenger

## Minimum pass requirement
No phase passes on owner sign-off alone.
Required:
- owner says implementation is ready
- confirmer verifies evidence is sufficient
- challenger fails to break critical path
