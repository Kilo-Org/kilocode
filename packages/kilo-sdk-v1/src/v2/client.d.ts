// Types only. The v1 SDK view-model shapes that the VS Code extension still renders on the Kilo v2 server.
// The extension has no v1 runtime client: src/services/cli-backend/v2/ in packages/kilo-vscode implements
// `KiloClient` over `@opencode/client`. Every import of this package is a strangler target (see the PR).
export * from "./gen/types.gen.js"
export type { FileSystemEntry as LocationFileSystemEntry } from "./gen/types.gen.js"
export type { Config as KiloClientConfig } from "./gen/client/types.gen.js"
export type { KiloClient } from "./gen/sdk.gen.js"
