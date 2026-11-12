import { describe, expect, test } from "bun:test"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import type { Types } from "effect"
import { KiloSubagentBackgroundPlugin } from "../src/subagent-background"

type Call = Record<string, unknown>
type MutableInfo = Types.Mutable<Tool.Info>
type Editor = { update: (id: string, update: (tool: MutableInfo) => void) => void }

const deploy = async () => {
  const definition = {
    name: SubagentTool.name,
    description: SubagentTool.description,
    input: SubagentTool.Input,
    execute: () => Effect.void,
  } as unknown as MutableInfo
  const editor: Editor = {
    update: (id, update) => {
      expect(id).toBe("subagent")
      update(definition)
    },
  }
  const ctx = { tool: { transform: (fn: (editor: Editor) => void) => Effect.sync(() => fn(editor)) } }

  await Effect.runPromise(Effect.scoped(KiloSubagentBackgroundPlugin.effect(ctx as never)))

  const schema = definition.input as Schema.Codec<Call>
  return { definition, schema, decode: Schema.decodeUnknownSync(schema) }
}

const call = { agent: "general", description: "Review the diff", prompt: "Review the diff" }

describe("kilocode.subagent-background", () => {
  test("runs a call that omits background in the background", async () => {
    const { decode } = await deploy()
    expect(decode(call).background).toBe(true)
  })

  test("lets a call wait for the answer inline", async () => {
    const { decode } = await deploy()
    expect(decode({ ...call, background: false }).background).toBe(false)
  })

  test("tells the model which default it gets", async () => {
    const { definition, schema } = await deploy()
    expect(definition.description).toContain("Runs in the background by default")
    expect(definition.description).not.toContain("Foreground (default)")

    const document = Schema.toJsonSchemaDocument(schema).schema as {
      properties?: Record<string, unknown>
      required?: ReadonlyArray<string>
    }
    expect(document.properties?.background).toMatchObject({ description: expect.stringContaining("Defaults to true") })
    expect(document.required).not.toContain("background")
  })

  test("encourages the background instead of presenting it as the exception", async () => {
    const { definition, schema } = await deploy()
    expect(definition.description).not.toContain("Use background only")
    expect(definition.description).not.toContain("background=true")
    expect(definition.description).toContain("run in parallel")
    expect(definition.description).toContain("Pass background: false only when you need the subagent's answer")

    const document = Schema.toJsonSchemaDocument(schema).schema as {
      properties?: Record<string, unknown>
    }
    expect(document.properties?.background).toMatchObject({
      description: expect.stringContaining("Set false only when you need the answer"),
    })
  })

  test("keeps the rest of the upstream description", async () => {
    const { definition } = await deploy()
    expect(definition.description).toContain("Spawns an agent in a child session to work on the specified task.")
    expect(definition.description).toContain("The output includes a sessionID you can pass back later")
  })
})
