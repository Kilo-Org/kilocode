# Architecture

Devil is a Bun and TypeScript monorepo. The CLI in `packages/opencode/` is the core engine; every product either runs it in-process or communicates with `devil serve`.

## Product Boundaries

| Product | Package | Responsibility |
| --- | --- | --- |
| Devil CLI | `packages/opencode/` | Agent runtime, tools, sessions, TUI, HTTP server, SSE, provider integration. |
| Devil VS Code Extension | `packages/devil-vscode/` | VS Code sidebar, Agent Manager, bundled CLI process, extension webviews. |
| Devil Docs | `packages/devil-docs/` | Next.js documentation site. |
| Devil Gateway | `packages/devil-gateway/` | Auth, provider routing, Kilo/Devil API integration. |
| Devil Telemetry | `packages/devil-telemetry/` | PostHog and OpenTelemetry integration. |
| Devil UI | `packages/devil-ui/` | Shared SolidJS component library. |
| SDK | `packages/sdk/js/` | Generated TypeScript client for the CLI server API. |
| OpenCode Web/Desktop | `packages/app/`, `packages/desktop/` | Upstream-synced clients, not actively maintained. |

## Dependency Direction

- Product clients depend on the CLI API through `@devilcode/sdk`.
- Shared OpenCode packages should stay close to upstream.
- Devil-specific behavior belongs in `devilcode` or `devil-*` paths whenever possible.
- Generated SDK code is regenerated, never hand-edited.

## Core CLI Patterns

- Namespace modules export schemas, types, and functions together.
- Zod schemas validate data at boundaries.
- `Instance.state(init, dispose?)` is used for per-project lazy state.
- `Tool.define(id, init)` is the tool declaration pattern.
- `BusEvent.define(type, schema)` and `Bus.publish()` are the in-process event system.
- `NamedError.create(name, schema)` is preferred for structured errors.
- `Log.create({ service: "name" })` is the logging pattern.

## Compatibility Naming

Devil is the public product identity. Kilo names remain where changing them would break users, marketplace identity, persisted settings, command IDs, or package imports. New architecture docs and tooling should call out compatibility exceptions explicitly instead of spreading mixed names.
