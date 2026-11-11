import { expect, test } from "bun:test"
import { Effect } from "effect"
import { z } from "zod"
import { email, object, startsWith, string } from "zod/mini"
import type { Info } from "@opencode/schema/tool"
import { definition } from "../../src/tool/runtime"

const execute = () => Effect.succeed({ output: "" })

test("zod tool schemas drop the non-standard string-check formats and keep pattern and standard formats", () => {
  const tool: Info = {
    name: "classic",
    description: "Classic Zod tool",
    input: z.object({
      prefix: z.string().startsWith("x"),
      suffix: z.string().endsWith("y"),
      infix: z.string().includes("z"),
      tags: z.array(z.string().startsWith("#")),
      email: z.email(),
    }),
    output: z.string().startsWith("ok"),
    execute,
  }

  const result = definition(tool)

  expect(result.inputSchema).toMatchObject({
    properties: {
      prefix: { type: "string", pattern: "^x.*" },
      suffix: { type: "string", pattern: ".*y$" },
      infix: { type: "string", pattern: "z" },
      tags: { type: "array", items: { type: "string", pattern: "^#.*" } },
      email: { type: "string", format: "email" },
    },
  })
  expect(result.outputSchema).toMatchObject({ type: "string", pattern: "^ok.*" })
  expect(JSON.stringify(result)).not.toMatch(/"format":"(starts_with|ends_with|includes)"/)
})

test("zod/mini tool schemas, converted without Standard JSON Schema, drop the same formats", () => {
  const tool: Info = {
    name: "mini",
    description: "Zod mini tool",
    input: object({ prefix: string().check(startsWith("x")), email: email() }),
    execute,
  }

  const result = definition(tool)

  expect(result.inputSchema).toMatchObject({
    properties: {
      prefix: { type: "string", pattern: "^x.*" },
      email: { type: "string", format: "email" },
    },
  })
  expect(JSON.stringify(result)).not.toMatch(/"format":"(starts_with|ends_with|includes)"/)
})
