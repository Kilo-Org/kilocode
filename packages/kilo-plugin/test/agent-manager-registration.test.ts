import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { register } from "../src/agent-manager"
import { makeTools } from "../src/agent-manager/tool"

const previous = process.env.KILO_AGENT_MANAGER_HOST

afterEach(() => {
  if (previous === undefined) delete process.env.KILO_AGENT_MANAGER_HOST
  else process.env.KILO_AGENT_MANAGER_HOST = previous
})

function host() {
  const added: string[] = []
  const ctx = {
    tool: {
      transform: (fn: (editor: { add: (tool: { name: string }) => void }) => void) =>
        Effect.sync(() => fn({ add: (tool) => added.push(tool.name) })),
    },
  }
  return { ctx, added }
}

const tools = makeTools({} as never)

test("registers the agent_manager tool only with the VS Code host signal", async () => {
  delete process.env.KILO_AGENT_MANAGER_HOST
  const plain = host()
  await Effect.runPromise(Effect.scoped(register(plain.ctx as never, tools)))
  expect(plain.added).toEqual(["agent_manager_models"])

  process.env.KILO_AGENT_MANAGER_HOST = "1"
  const hosted = host()
  await Effect.runPromise(Effect.scoped(register(hosted.ctx as never, tools)))
  expect(hosted.added).toEqual(["agent_manager", "agent_manager_models"])
})
