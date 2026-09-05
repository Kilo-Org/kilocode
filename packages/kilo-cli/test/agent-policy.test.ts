import { expect, test } from "bun:test"
import { Permission } from "@opencode-ai/core/permission"
import path from "node:path"
import { fixture } from "./fixture"

const root = path.resolve(import.meta.dir, "..")
const bundledBun = path.join(root, "dist/interactive/bun")
const hostFixture = path.join(import.meta.dir, "agent-policy-fixture.ts")

test("agent policy uses the bundled Bun host and public client contract", async () => {
  expect(await Bun.file(bundledBun).exists()).toBe(true)
  expect((await run(bundledBun, ["--version"])).stdout.trim()).toBe("1.4.0")

  const native = await host({
    permissions: [{ action: "read", resource: "secret.txt", effect: "deny" }],
  })
  expect(native.agents.find((agent) => agent.id === "build")).toMatchObject({ name: "Code", mode: "primary" })
  expect(native.agents.find((agent) => agent.id === "ask")).toMatchObject({ name: "Ask", mode: "primary" })
  expect(native.agents.find((agent) => agent.id === "debug")).toMatchObject({ name: "Debug", mode: "primary" })
  expect(native.agents.find((agent) => agent.id === "orchestrator")).toBeUndefined()
  expect(native.agents.find((agent) => agent.id === "plan")).toMatchObject({ name: "Plan", mode: "primary" })
  expect(native.agents.find((agent) => agent.id === "compaction")).toMatchObject({ hidden: true })

  const ask = native.agents.find((agent) => agent.id === "ask")!
  const debug = native.agents.find((agent) => agent.id === "debug")!
  expect(ask.system).toContain("This supersedes any other instructions")
  expect(ask.system).toContain("plain-text or ASCII diagrams")
  expect(debug.system).toContain("Reflect on 5-7")
  expect(Permission.evaluate("read", "src/index.ts", ask.permissions).effect).toBe("allow")
  expect(Permission.evaluate("read", ".env", ask.permissions).effect).toBe("ask")
  expect(Permission.evaluate("shell", "git status", ask.permissions).effect).toBe("deny")
  expect(Permission.evaluate("edit", "src/index.ts", ask.permissions).effect).toBe("deny")
  expect(Permission.evaluate("subagent", "general", ask.permissions).effect).toBe("deny")
  expect(Permission.evaluate("read", "secret.txt", ask.permissions).effect).toBe("deny")
  expect(Permission.evaluate("read", "secret.txt", debug.permissions).effect).toBe("deny")
  expect(native.runtime?.calls).toContain("ask:shell")
  expect(native.runtime?.calls).toContain("debug:read")
  expect(native.runtime?.askPermissions).toBe(0)
  expect(native.runtime?.debugPermissions).toBe(0)

  const custom = await host(
    {
      agents: {
        ask: {
          description: "Project-owned Ask agent",
          mode: "subagent",
          system: "Project prompt wins.",
          permissions: [{ action: "shell", resource: "*", effect: "allow" }],
        },
        plan: {
          description: "Project-owned Plan overlay",
          system: "Project Plan prompt wins.",
        },
      },
    },
    false,
  )
  expect(custom.agents.find((agent) => agent.id === "ask")).toMatchObject({
    description: "Project-owned Ask agent",
    mode: "subagent",
    system: "Project prompt wins.",
  })
  expect(
    Permission.evaluate("shell", "git status", custom.agents.find((agent) => agent.id === "ask")!.permissions).effect,
  ).toBe("allow")
  expect(custom.agents.find((agent) => agent.id === "plan")).toMatchObject({
    description: "Project-owned Plan overlay",
    system: "Project Plan prompt wins.",
  })
})

type Agent = {
  readonly id: string
  readonly name: string
  readonly mode: string
  readonly hidden: boolean
  readonly permissions: Permission.Ruleset
  readonly description?: string
  readonly system?: string
}

type Host = {
  readonly agents: Agent[]
  readonly defaultAgent?: string
  readonly runtime?: { readonly calls: string[]; readonly askPermissions: number; readonly debugPermissions: number }
}

test("native default-agent fallback already resolves Code configuration without duplicating the coding agent", async () => {
  const native = await host({ default_agent: "code" }, false)
  expect(native.defaultAgent).toBe("build")
  expect(native.agents.filter((agent) => agent.name === "Code").map((agent) => agent.id)).toEqual(["build"])
  expect(native.agents.find((agent) => agent.id === "code")).toBeUndefined()

  const custom = await host(
    {
      default_agent: "code",
      agents: { code: { mode: "primary", system: "Project-owned coding policy." } },
    },
    false,
  )
  expect(custom.defaultAgent).toBe("code")
  expect(custom.agents.find((agent) => agent.id === "code")?.system).toBe("Project-owned coding policy.")

  const explicit = await host({ default_agent: "ask" }, false)
  expect(explicit.defaultAgent).toBe("ask")
})

async function host(config: object, exercise = true) {
  await using input = await fixture()
  const result = await run(bundledBun, ["--no-env-file", hostFixture], {
    ...input.env,
    KILO_AGENT_POLICY_CONFIG: JSON.stringify(config),
    KILO_AGENT_POLICY_CWD: input.cwd,
    KILO_AGENT_POLICY_EXERCISE: String(exercise),
  })
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as Host
}

async function run(binary: string, args: string[], env?: NodeJS.ProcessEnv) {
  const child = Bun.spawn([binary, ...args], {
    cwd: root,
    env: env ?? { PATH: process.env.PATH },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 30_000,
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}
