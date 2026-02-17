# Agent Manager — Spec Launch Order

## Dependency Graph

```
Spec 01: Worktree Support
    ├── Spec 03: Parallel Versions   (needs worktrees)
    └── Spec 04: Setup Script        (needs worktrees)

Spec 02: Per-Session Model/Mode      (independent)
```

## Suggested Launch Order

| Order | Spec                                                                  | Branch from                                       |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------- |
| 1     | [Spec 01](spec-01-worktree-support.md) — Git Worktree Support         | `feat/port-agent-manager`                         |
| 2     | [Spec 02](spec-02-per-session-model-mode.md) — Per-Session Model/Mode | `feat/port-agent-manager` (parallel with Spec 01) |
| 3     | [Spec 03](spec-03-parallel-versions.md) — Parallel Versions           | after Spec 01 merged                              |
| 4     | [Spec 04](spec-04-worktree-setup-script.md) — Setup Script            | after Spec 01 merged                              |

## Notes

- Spec 01 and Spec 02 can be launched in parallel — they touch different parts of the codebase
- Spec 03 and Spec 04 both depend on Spec 01 but are independent of each other — can also be parallelized
- All specs should branch from `feat/port-agent-manager` (or its merge target `dev`) so they build on the current Agent Manager foundation
- Before starting Spec 02, have a brief discussion with the backend team about whether `POST /session` should accept model/agent defaults (server change) vs per-message overrides only (no server change) — this decision determines the implementation approach
