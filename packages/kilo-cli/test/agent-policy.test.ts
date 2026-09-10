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

  const explore = native.agents.find((agent) => agent.id === "explore")!
  expect(explore.mode).toBe("subagent")
  expect(explore.description).toContain("Fast agent specialized for exploring codebases")
  expect(explore.description).toContain("Bash is limited to an allowlist of read-only commands")
  // Read-only shell ceiling via real last-match evaluation: the allowlist and git reads win over
  // the reinstated catch-all deny; everything else stays denied.
  expect(Permission.evaluate("shell", "cat package.json", explore.permissions).effect).toBe("allow")
  expect(Permission.evaluate("shell", "rg --files", explore.permissions).effect).toBe("allow")
  expect(Permission.evaluate("shell", "git status", explore.permissions).effect).toBe("allow")
  expect(Permission.evaluate("shell", "git log --oneline -5", explore.permissions).effect).toBe("allow")
  expect(Permission.evaluate("shell", "git push origin main", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "gh pr list", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "find . -delete", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "sort --compress-program=gzip big.txt", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "sort -o out.txt input.txt", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "rg --pre cat secret", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "cat a.txt; rm b.txt", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "cat a.txt | sh", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "echo $(whoami)", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "echo `whoami`", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "echo hi > out.txt", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "unknowncmd --flag", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("skill", "find-skills", explore.permissions).effect).toBe("allow")
  expect(Permission.evaluate("semantic_search", "how does auth work", explore.permissions).effect).toBe("allow")
  expect(Permission.evaluate("edit", "src/index.ts", explore.permissions).effect).toBe("deny")
  // Real host runs: allowed commands execute (no error part), denied commands are blocked before
  // execution (error part present).
  expect(native.runtime?.explore).toEqual({
    cat: false,
    gitStatus: false,
    gitPush: true,
    find: true,
    sortOutput: true,
    sortCompress: true,
    rgPre: true,
    chain: true,
    pipe: true,
    substitution: true,
    backtick: true,
    redirect: true,
    redirectWroteFile: false,
  })

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

type Explore = {
  readonly cat: boolean
  readonly gitStatus: boolean
  readonly gitPush: boolean
  readonly find: boolean
  readonly sortOutput: boolean
  readonly sortCompress: boolean
  readonly rgPre: boolean
  readonly chain: boolean
  readonly pipe: boolean
  readonly substitution: boolean
  readonly backtick: boolean
  readonly redirect: boolean
  readonly redirectWroteFile: boolean
}

type Host = {
  readonly agents: Agent[]
  readonly defaultAgent?: string
  readonly runtime?: {
    readonly calls: string[]
    readonly askPermissions: number
    readonly debugPermissions: number
    readonly explore: Explore
  }
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

test("explore ceiling keeps explicit configured shell denies winning over the allowlist", async () => {
  // The explore policy runs before config, so a configured deny lands after the ceiling and wins
  // by last-match with no re-append. Real execution confirms the deny and the surviving allowlist.
  const user = await host({
    agents: {
      explore: { permissions: [{ action: "shell", resource: "git status *", effect: "deny" }] },
    },
  })
  const explore = user.agents.find((agent) => agent.id === "explore")!
  expect(Permission.evaluate("shell", "git status", explore.permissions).effect).toBe("deny")
  expect(Permission.evaluate("shell", "cat package.json", explore.permissions).effect).toBe("allow")
  expect(Permission.evaluate("shell", "git log --oneline", explore.permissions).effect).toBe("allow")
  expect(user.runtime?.explore.gitStatus).toBe(true)
  expect(user.runtime?.explore.cat).toBe(false)
})

test("explore ceiling is not reopened by broad global or agent shell allows", async () => {
  // A broad config allow lands after the ceiling, so pure ruleset evaluation would reopen a
  // table-denied command. The post permission.evaluate ceiling forces the deny in the real assert
  // path, so real execution still blocks them while allowlisted commands run.
  const broad = await host({
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
    agents: {
      explore: { permissions: [{ action: "shell", resource: "*", effect: "allow" }] },
    },
  })
  expect(broad.runtime?.explore).toEqual({
    cat: false,
    gitStatus: false,
    gitPush: true,
    find: true,
    sortOutput: true,
    sortCompress: true,
    rgPre: true,
    chain: true,
    pipe: true,
    substitution: true,
    backtick: true,
    redirect: true,
    redirectWroteFile: false,
  })

  // A configured Explore keeps its own description and system prompt but still receives the ceiling.
  const custom = await host(
    {
      agents: { explore: { description: "Project-owned Explore", system: "Project prompt." } },
    },
    false,
  )
  const owned = custom.agents.find((agent) => agent.id === "explore")!
  expect(owned.description).toBe("Project-owned Explore")
  expect(owned.description).not.toContain("Bash is limited")
  expect(owned.system).toBe("Project prompt.")
})

test("enforced post ceiling still denies unsafe commands when the pre policy is disabled", async () => {
  // Removing the default-phase explore policy stops the agent.transform from appending the
  // exploreBash rules, so with a broad shell allow the agent ruleset alone would allow everything.
  // The enforced post kilocode.agent-policy permission.evaluate ceiling still forces the deny for
  // table-denied resources, and the redirect is blocked before any child write reaches disk.
  const disabled = await host({
    plugins: ["-kilocode.explore-policy"],
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
    agents: {
      explore: { permissions: [{ action: "shell", resource: "*", effect: "allow" }] },
    },
  })
  expect(disabled.runtime?.explore).toEqual({
    cat: false,
    gitStatus: false,
    gitPush: true,
    find: true,
    sortOutput: true,
    sortCompress: true,
    rgPre: true,
    chain: true,
    pipe: true,
    substitution: true,
    backtick: true,
    redirect: true,
    redirectWroteFile: false,
  })

  // The post kilocode.agent-policy plugin is host-enforced: a config remove operation cannot
  // disable or shadow it, so the ceiling survives an attempted disable of the post ID itself.
  const attemptedPostDisable = await host({
    plugins: ["-kilocode.agent-policy"],
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
    agents: {
      explore: { permissions: [{ action: "shell", resource: "*", effect: "allow" }] },
    },
  })
  expect(attemptedPostDisable.runtime?.explore.gitPush).toBe(true)
  expect(attemptedPostDisable.runtime?.explore.redirect).toBe(true)
  expect(attemptedPostDisable.runtime?.explore.redirectWroteFile).toBe(false)
  expect(attemptedPostDisable.runtime?.explore.cat).toBe(false)
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
