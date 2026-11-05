import { expect, test } from "bun:test"
import { Effect } from "effect"
import { z } from "zod"
import type { Info } from "@opencode/schema/tool"
import { definition } from "../../src/tool/runtime"

// zod 4.6's `flattenRef` reads `ctx.seen.get(schema).ref` without a guard, but
// `processSchema` registers a schema's `parent` only in the branch it skips when the schema
// carries a custom `toJSONSchema` override. A field with both a refinement (which sets
// `_zod.parent`) and an override is therefore absent from `seen` while flattening still
// recurses into it, so the conversion threw and took down every prompt that built tool
// schemas. `patches/zod@4.6.7.patch` treats an unregistered schema as nothing to flatten.
test("a zod tool field with both a refinement and a JSON Schema override converts", () => {
  const count = z.string().min(1)
  count._zod.toJSONSchema = () => ({ type: "string", title: "count" })
  const tool: Info = {
    name: "override",
    description: "Override tool",
    input: z.object({ count, note: z.string().describe("note") }),
    output: z.object({ ok: z.boolean() }),
    execute: () => Effect.succeed({ output: { ok: true } }),
  }

  expect(definition(tool).inputSchema).toMatchObject({
    type: "object",
    properties: { count: { type: "string", title: "count" }, note: { type: "string", description: "note" } },
    required: ["count", "note"],
  })
})
