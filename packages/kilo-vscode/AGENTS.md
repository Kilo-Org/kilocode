# AGENTS.md

The Kilo VS Code extension on the Kilo v2 line. It is the v1 extension from `main` (same webview, components and
styles) running on the Kilo v2 server, with only the chat path. Read the v2 rules in the repository `AGENTS.md` first.

## Start here

| Area | Entry points |
|---|---|
| Server process | [server-manager.ts](src/services/cli-backend/server-manager.ts) spawns `bin/kilo2` or `script/dev-isolated.ts serve --port 0 --stdio` with an isolated `KILO_V2_PROFILE`; the open stdin pipe is the process lifetime |
| Connection | [connection-service.ts](src/services/cli-backend/connection-service.ts), [sdk-sse-adapter.ts](src/services/cli-backend/sdk-sse-adapter.ts) |
| v2 translation layer | [v2/](src/services/cli-backend/v2/): `client.ts` (v1 `KiloClient` facade over `@opencode/client`), `events.ts` (v2 events to v1 events), `projection.ts` (v2 records to v1 records) |
| Local HTTP | [local.ts](src/services/cli-backend/local.ts): `fetch` over `node:http` for every request to the local server |
| Features | [features.ts](src/features.ts): only `chat` is on |
| Host and webview messages | [KiloProvider.ts](src/KiloProvider.ts), [handlers](src/kilo-provider/), [message contracts](webview-ui/src/types/messages/) |
| Webview | [App.tsx](webview-ui/src/App.tsx), [contexts](webview-ui/src/context/), [styles](webview-ui/src/styles/) |
| UI packages | `@kilocode/kilo-ui` (`packages/kilo-ui`), `@opencode-ai/ui` (`packages/kilo-ui-base`, the v1 UI base), `@kilocode/kilo-i18n` |
| v1 types | `@kilocode/sdk-v1` (`packages/kilo-sdk-v1`), declarations only, no runtime client |

## Rules

- The host and webview keep the v1 SDK shapes as their view model. Map the v2 server to them only in `v2/`. Never import
  a v1 runtime SDK. Import `@kilocode/sdk-v1` with `import type`.
- An SDK method that `v2/client.ts` does not map fails with an error and logs once. Never return fake data for it.
- Use `local` from `local.ts` for requests to the local server. The VS Code extension host replaces the global `fetch`
  with a proxy-aware one that does not stream SSE chunk by chunk.
- The v2 Basic auth user is `opencode`. There is no `KILO_PARENT_PID` watchdog: closing stdin stops the server.
- A feature that is off has no code in this package. Port it in its own PR, on the v2 API, and turn it on in
  `features.ts`. Do not stub it.
- Do not use the installed Kilo CLI or its data. `bun run extension [--fresh] [workspace]` from the repository root
  starts VS Code with a separate user data directory and a v2 profile under `.kilo-dev/` (or a temporary one with
  `--fresh`).

## Checks

From this directory: `bun typecheck`, `bun run lint`, `bun test`, `bun run build`. Self-test UI changes in real
VS Code with the `vscode-self-test` harness.
