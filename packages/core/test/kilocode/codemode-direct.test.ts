import { expect } from "bun:test"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/schema/session"
import type { Info } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { it } from "../lib/effect"
import { codeModeListings, executeTool, toolIdentity } from "../lib/tool"

const node = AppNodeBuilder.build(Tool.node, [
  Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
])

const board = {
  name: "board_read",
  description: "Read the shared board",
  input: Schema.Struct({ since: Schema.optional(Schema.String) }),
  execute: () => Effect.succeed({ content: "board message" }),
} satisfies Info

// A Code Mode tool with `direct: true` stays on the provider's native tool list, because clients render it by name,
// and is callable inside `execute` as well. Without the option it is only a Code Mode tool.
it.effect("keeps a direct tool on both the native and the Code Mode tool list", () =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    yield* tools.transform((editor) => {
      editor.add({ ...board, options: { direct: true } })
      editor.add({ ...board, name: "board_script" })
      editor.add({ ...board, name: "board_native", options: { codemode: false } })
    })

    const snapshot = yield* tools.snapshot()
    const native = snapshot.definitions.map((tool) => tool.name)
    expect(native).toContain("board_read")
    expect(native).toContain("execute")
    expect(native).toContain("board_native")
    expect(native).not.toContain("board_script")

    const catalog = snapshot.codeModeCatalog!
    const listings = codeModeListings(catalog)
    expect(listings.map((entry) => entry.path)).toContain("board_read")
    expect(listings.map((entry) => entry.path)).toContain("board_script")
    expect(listings.map((entry) => entry.path)).not.toContain("board_native")
    expect(listings.find((entry) => entry.path === "board_read")?.line).toContain("// [direct] Read the shared board")
    expect(listings.find((entry) => entry.path === "board_script")?.line).not.toContain("[direct]")

    const summary = CodeModeCatalog.summarize(catalog)
    expect(summary.direct).toBe(true)
    expect(CodeModeInstructions.render(summary)).toContain(
      "A tool marked `[direct]` is also a normal tool call: use it either way, directly or inside `execute`.",
    )
    expect(CodeModeInstructions.render(summary)).toContain(
      "## Code Mode tools (call inside `execute`; `[direct]` tools also directly)",
    )

    const sessionID = Session.ID.make("ses_direct")
    const direct = yield* executeTool(tools, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: "call_direct", name: "board_read", input: {} },
    })
    expect(direct.status).toBe("completed")
    expect(direct.content).toEqual([{ type: "text", text: "board message" }])

    const nested = yield* executeTool(tools, {
      sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_nested",
        name: "execute",
        input: { code: "return await tools.board_read({})" },
      },
    })
    expect(nested.status).toBe("completed")
    expect(nested.content).toEqual([{ type: "text", text: "board message" }])

    const unavailable = yield* executeTool(tools, {
      sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_native",
        name: "execute",
        input: { code: "return await tools.board_native({})" },
      },
    })
    expect(unavailable.output?.error).toBe(true)
  }).pipe(Effect.scoped, Effect.provide(node)),
)
