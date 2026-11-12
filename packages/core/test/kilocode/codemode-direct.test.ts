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
import { readInitial, readUpdate } from "../lib/instructions"
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

// The marker changes the invariant paragraph and heading, so a catalog that first shows a marked tool is superseded
// as a whole instead of described by a delta.
it.effect("supersedes the catalog when a direct tool first appears", () =>
  Effect.gen(function* () {
    const plain: CodeModeCatalog.Tool = {
      type: "tool",
      name: "board_read",
      description: "Read the shared board",
      signature: "tools.board_read(): Promise<string | null>",
    }
    const previous = yield* readInitial(CodeModeInstructions.make({ tools: [plain] }))
    const current = yield* readUpdate(CodeModeInstructions.make({ tools: [{ ...plain, direct: true }] }), previous)

    expect(previous.text).toContain("## Code Mode tools (call only inside `execute`)")
    expect(current.text).toContain("This catalog supersedes the previous Code Mode tool catalog.")
    expect(current.text).toContain("## Code Mode tools (call inside `execute`; `[direct]` tools also directly)")
    expect(current.text).toContain("tools.board_read(): Promise<string | null> // [direct] Read the shared board")

    // The supersede happens once: a later catalog change while a marked tool is shown stays a delta.
    const added = yield* readUpdate(
      CodeModeInstructions.make({
        tools: [
          { ...plain, direct: true },
          {
            type: "tool",
            name: "board_post",
            description: "Post to the shared board",
            signature: "tools.board_post(): Promise<string | null>",
            direct: true,
          },
        ],
      }),
      current,
    )
    expect(added.text).not.toContain("This catalog supersedes the previous Code Mode tool catalog.")
    // board_post is its own top-level namespace, so it is reported as a new namespace delta, not a supersede.
    expect(added.text).toContain("New tools are available:")
    expect(added.text).toContain("// [direct] Post to the shared board")
  }),
)
