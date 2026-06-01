// kilocode_change - new file
import { expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { Global } from "@opencode-ai/core/global"

const it = testEffect(Agent.defaultLayer)

it.instance("code agent allows global config directory reads by default", () =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const code = yield* agent.get("code")
    expect(code).toBeDefined()
    expect(Permission.evaluate("external_directory", `${Global.Path.config}/*`, code!.permission).action).toBe("allow")
  }),
)
