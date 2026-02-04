---
name: evals-context
description: Provides context about the Roo Code evals system structure in this monorepo. Use when tasks mention "evals", "evaluation", "eval runs", "eval exercises", or working with the evals infrastructure. Helps distinguish between the evals execution system (packages/evals, apps/web-evals) and the public website evals display page (apps/web-roo-code/src/app/evals).
---

# Evals Codebase Context

## When to Use This Skill

Use this skill when the task involves:

- Modifying or debugging the evals execution infrastructure
- Adding new eval exercises or languages
- Working with the evals web interface (apps/web-evals)
- Modifying the public evals display page on roocode.com
- Understanding where evals code lives in this monorepo

## When NOT to Use This Skill

Do NOT use this skill when:

- Working on unrelated parts of the codebase (extension, webview-ui, etc.)
- The task is purely about the VS Code extension's core functionality
- Working on the main website pages that don't involve evals

## Key Disambiguation: Two "Evals" Locations

This monorepo has **two distinct evals-related locations** that can cause confusion:

| Component                   | Path                                                           | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| **Evals Execution System**  | `packages/evals/`                                              | Core eval infrastructure: CLI, DB schema, Docker configs       |
| **Evals Management UI**     | `apps/web-evals/`                                              | Next.js app for creating/monitoring eval runs (localhost:3446) |
| **Website Evals Page**      | `apps/web-roo-code/src/app/evals/`                             | Public roocode.com page displaying eval results                |
| **External Exercises Repo** | [Roo-Code-Evals](https://github.com/RooCodeInc/Roo-Code-Evals) | Actual coding exercises (NOT in this monorepo)                 |

## Directory Structure Reference

### `packages/evals/` - Core Evals Package

```
packages/evals/
├── ARCHITECTURE.md          # Detailed architecture documentation
├── ADDING-EVALS.md          # Guide for adding new exercises/languages
├── README.md                # Setup and running instructions
├── docker-compose.yml       # Container orchestration
├── Dockerfile.runner        # Runner container definition
├── Dockerfile.web           # Web app container
├── drizzle.config.ts        # Database ORM config
├── src/
│   ├── index.ts             # Package exports
│   ├── cli/                 # CLI commands for running evals
│   │   ├── runEvals.ts      # Orchestrates complete eval runs
│   │   ├── runTask.ts       # Executes individual tasks in containers
│   │   ├── runUnitTest.ts   # Validates task completion via tests
│   │   └── redis.ts         # Redis pub/sub integration
│   ├── db/
│   │   ├── schema.ts        # Database schema (runs, tasks)
│   │   ├── queries/         # Database query functions
│   │   └── migrations/      # SQL migrations
│   └── exercises/
│       └── index.ts         # Exercise loading utilities
└── scripts/
    └── setup.sh             # Local macOS setup script
```

### `apps/web-evals/` - Evals Management Web App

```
apps/web-evals/
├── src/
│   ├── app/
│   │   ├── page.tsx         # Home page (runs list)
│   │   ├── runs/
│   │   │   ├── new/         # Create new eval run
│   │   │   └── [id]/        # View specific run status
│   │   └── api/runs/        # SSE streaming endpoint
│   ├── actions/             # Server actions
│   │   ├── runs.ts          # Run CRUD operations
│   │   ├── tasks.ts         # Task queries
│   │   ├── exercises.ts     # Exercise listing
│   │   └── heartbeat.ts     # Controller health checks
│   ├── hooks/               # React hooks (SSE, models, etc.)
│   └── lib/                 # Utilities and schemas
```

### `apps/web-roo-code/src/app/evals/` - Public Website Evals Page

```
apps/web-roo-code/src/app/evals/
├── page.tsx      # Fetches and displays public eval results
├── evals.tsx     # Main evals display component
├── plot.tsx      # Visualization component
└── types.ts      # EvalRun type (extends packages/evals types)
```

This page **displays** eval results on the public roocode.com website. It imports types from `@roo-code/evals` but does NOT run evals.

## Architecture Overview

The evals system is a distributed evaluation platform that runs AI coding tasks in isolated VS Code environments:

```
┌─────────────────────────────────────────────────────────────┐
│  Web App (apps/web-evals)  ──────────────────────────────── │
│        │                                                    │
│        ▼                                                    │
│  PostgreSQL ◄────► Controller Container                     │
│        │               │                                    │
│        ▼               ▼                                    │
│     Redis ◄───► Runner Containers (1-25 parallel)           │
└─────────────────────────────────────────────────────────────┘
```

**Key components:**

- **Controller**: Orchestrates eval runs, spawns runners, manages task queue (p-queue)
- **Runner**: Isolated Docker container with VS Code + Roo Code extension + language runtimes
- **Redis**: Pub/sub for real-time events (NOT task queuing)
- **PostgreSQL**: Stores runs, tasks, metrics

## Common Tasks Quick Reference

### Adding a New Eval Exercise

1. Add exercise to [Roo-Code-Evals](https://github.com/RooCodeInc/Roo-Code-Evals) repo (external)
2. See [`packages/evals/ADDING-EVALS.md`](packages/evals/ADDING-EVALS.md) for structure

### Modifying Eval CLI Behavior

Edit files in [`packages/evals/src/cli/`](packages/evals/src/cli/):

- [`runEvals.ts`](packages/evals/src/cli/runEvals.ts) - Run orchestration
- [`runTask.ts`](packages/evals/src/cli/runTask.ts) - Task execution
- [`runUnitTest.ts`](packages/evals/src/cli/runUnitTest.ts) - Test validation

### Modifying the Evals Web Interface

Edit files in [`apps/web-evals/src/`](apps/web-evals/src/):

- [`app/runs/new/new-run.tsx`](apps/web-evals/src/app/runs/new/new-run.tsx) - New run form
- [`actions/runs.ts`](apps/web-evals/src/actions/runs.ts) - Run server actions

### Modifying the Public Evals Display Page

Edit files in [`apps/web-roo-code/src/app/evals/`](apps/web-roo-code/src/app/evals/):

- [`evals.tsx`](apps/web-roo-code/src/app/evals/evals.tsx) - Display component
- [`plot.tsx`](apps/web-roo-code/src/app/evals/plot.tsx) - Charts

### Database Schema Changes

1. Edit [`packages/evals/src/db/schema.ts`](packages/evals/src/db/schema.ts)
2. Generate migration: `cd packages/evals && pnpm drizzle-kit generate`
3. Apply migration: `pnpm drizzle-kit migrate`

## Running Evals Locally

```bash
# From repo root
pnpm evals

# Opens web UI at http://localhost:3446
```

**Ports (defaults):**

- PostgreSQL: 5433
- Redis: 6380
- Web: 3446

## Testing

```bash
# packages/evals tests
cd packages/evals && npx vitest run

# apps/web-evals tests
cd apps/web-evals && npx vitest run
```

## Key Types/Exports from `@roo-code/evals`

The package exports are defined in [`packages/evals/src/index.ts`](packages/evals/src/index.ts):

- Database queries: `getRuns`, `getTasks`, `getTaskMetrics`, etc.
- Schema types: `Run`, `Task`, `TaskMetrics`
- Used by both `apps/web-evals` and `apps/web-roo-code`
