import { expect, test } from "bun:test"
import { removeKiloWeb } from "./remove-kilo-web"

const INDEX = "packages/opencode/src/index.ts"

test("replaces the known Kilo web command import and registration with Kilo omissions", () => {
  const source = [
    'import { WebCommand } from "./cli/cmd/web"',
    'import { ServeCommand } from "./cli/cmd/serve"',
    "cli",
    "  .command(ServeCommand)",
    "  .command(WebCommand)",
    "  .command(ModelsCommand)",
    "",
  ].join("\n")

  expect(removeKiloWeb(INDEX, source)).toEqual({
    result: [
      "// kilocode_change - upstream web command intentionally omitted; Kilo does not ship an embedded web UI",
      'import { ServeCommand } from "./cli/cmd/serve"',
      "cli",
      "  .command(ServeCommand)",
      "  // kilocode_change - upstream web command intentionally omitted",
      "  .command(ModelsCommand)",
      "",
    ].join("\n"),
    removals: 1,
    review: false,
  })
})

test("flags an unfamiliar web command shape without changing it", () => {
  const source = 'import { WebCommand as Web } from "./cli/cmd/web"\ncli.command(Web)\n'

  expect(removeKiloWeb(INDEX, source)).toEqual({ result: source, removals: 0, review: true })
})

test("does not transform other files", () => {
  const source = 'import { WebCommand } from "./cli/cmd/web"\n'
  expect(removeKiloWeb("packages/opencode/src/other.ts", source)).toEqual({
    result: source,
    removals: 0,
    review: false,
  })
})
