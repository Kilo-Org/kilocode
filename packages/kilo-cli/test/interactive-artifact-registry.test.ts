import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// Every test file that gates on the interactive runtime must stay listed here.
// The default `bun run test` skips these proofs when `dist/interactive` is
// missing, so an unregistered gate would silently reduce coverage in CI. This
// meta-test scans the tree and fails when the discovered set drifts.
const INTERACTIVE_GATED_FILES = [
  "agent-policy.test.ts",
  "cloud-cli-subprocess.test.ts",
  "cloud-stream-cli.test.ts",
  "gateway-protocol.test.ts",
  "gateway-scope-acceptance.test.ts",
  "model-picker-ui.test.tsx",
  "model-prompt-policy.test.ts",
  "privacy-ui.test.tsx",
  "project-config.test.ts",
  "routed-model-integration.test.ts",
  "routed-model-title-leak.test.ts",
  "settings-ui.test.tsx",
  "sidebar-account-ui.test.tsx",
  "telemetry.test.ts",
]

const GATE_MARKER = /dist\/interactive|interactiveBun|interactiveKilo2/

test("interactive-gated test files are exactly the registered set", () => {
  const discovered = readdirSync(import.meta.dir)
    .filter((name) => name !== "interactive-artifact-registry.test.ts" && /\.test\.(ts|tsx)$/.test(name))
    .filter((name) => GATE_MARKER.test(readFileSync(path.join(import.meta.dir, name), "utf8")))
  expect(discovered.sort()).toEqual([...INTERACTIVE_GATED_FILES].sort())
})
