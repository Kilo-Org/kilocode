import { expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import { NodeFileSystem } from "@effect/platform-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { fixture, ready } from "./fixture"

test("explicit Kilo project discovery honors boundary/precedence and never discovers project plugins", async () => {
  await using input = await fixture()
  const project = path.join(input.home, "workspace", "project")
  await mkdir(path.join(project, ".kilo/skills/local"), { recursive: true })
  await mkdir(path.join(project, ".kilo/agents/team"), { recursive: true })
  await mkdir(path.join(project, ".kilocode"), { recursive: true })
  await mkdir(path.join(project, ".kilocode/agents"), { recursive: true })
  await mkdir(path.join(project, ".kilo/plugins"), { recursive: true })
  await mkdir(path.join(project, ".opencode"), { recursive: true })
  const git = Bun.spawn(["git", "init", "--quiet", project], { env: input.env, stdout: "ignore", stderr: "pipe" })
  expect(await git.exited, await new Response(git.stderr).text()).toBe(0)
  const sentinel = path.join(project, "plugin-executed")
  const poison = path.join(project, ".kilo/plugins/poison.ts")
  await Bun.write(poison, `await Bun.write(${JSON.stringify(sentinel)}, "executed"); throw new Error("POISON_PLUGIN")`)
  await Bun.write(
    path.join(project, "kilo.json"),
    JSON.stringify({ agents: { project_agent: { description: "json lower" } } }),
  )
  await Bun.write(
    path.join(project, "kilo.jsonc"),
    JSON.stringify({
      agents: { project_agent: { description: "jsonc higher" } },
      plugins: [poison],
      skills: [path.join(input.home, "external-agent"), "../../external-agent", ".kilo/skills/local"],
    }),
  )
  await Bun.write(
    path.join(project, ".kilo/kilo.jsonc"),
    JSON.stringify({ agents: { project_agent: { description: "dot kilo" } }, plugins: [poison] }),
  )
  await Bun.write(
    path.join(project, ".kilocode/kilo.jsonc"),
    JSON.stringify({ agents: { project_agent: { description: "legacy directory wins" } } }),
  )
  await Bun.write(
    path.join(project, ".kilo/agents/team/helper.md"),
    "---\ndescription: Lower priority markdown agent\nmode: subagent\n---\nLower priority instructions\n",
  )
  await Bun.write(
    path.join(project, ".kilo/agents/precedence.md"),
    "---\ndescription: Kilo markdown agent\nmode: subagent\n---\nKilo instructions\n",
  )
  await Bun.write(
    path.join(project, ".kilocode/agents/precedence.md"),
    "---\ndescription: Legacy directory markdown agent\nmode: subagent\n---\nLegacy directory instructions\n",
  )
  await Bun.write(
    path.join(project, ".kilocode/agents/legacy.md"),
    "---\nmodel: anthropic/claude-sonnet\ndescription: V1 markdown agent\nmode: subagent\ntools:\n  edit: false\n---\nV1 agent instructions\n",
  )
  await Bun.write(path.join(project, ".kilocode/agents/malformed.md"), "---\ndescription: 123\n---\nIgnored\n")
  await mkdir(path.join(input.home, "external-agent"))
  await Bun.write(
    path.join(input.home, "external-agent/reachable.md"),
    "---\ndescription: External markdown agent\n---\nShould not load\n",
  )
  await Bun.write(
    path.join(input.home, "external-agent/SKILL.md"),
    "---\nname: external-skill\n---\nOutside skill content\n",
  )
  await symlink(path.join(input.home, "external-agent/reachable.md"), path.join(project, ".kilo/agents/reachable.md"))
  await Bun.write(
    path.join(project, ".kilo/skills/local/SKILL.md"),
    "---\nname: local\ndescription: Local fixture skill\n---\nLocal skill instructions\n",
  )
  await Bun.write(path.join(input.home, "kilo.jsonc"), JSON.stringify({ agents: { home_leak: {} } }))
  await Bun.write(
    path.join(project, ".opencode/opencode.json"),
    JSON.stringify({ agents: { upstream_leak: {} }, plugins: [poison] }),
  )
  const bundledBun = path.resolve(import.meta.dir, "../dist/interactive/bun")
  if (!(await Bun.file(bundledBun).exists())) {
    console.warn(`Skipping live project-config host test: bundled runtime missing at ${bundledBun}`)
    return
  }
  const boot = async (enabled: boolean) => {
    const child = Bun.spawn(
      [
        bundledBun,
        "--no-env-file",
        path.join(import.meta.dir, "project-config-fixture.ts"),
        enabled ? "enabled" : "disabled",
      ],
      {
        cwd: project,
        env: input.env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        timeout: 20000,
      },
    )
    const errors = new Response(child.stderr).text()
    try {
      const endpoint = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
      const password = (
        await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
      ).trim()
      const client = OpenCode.make({
        baseUrl: endpoint.value,
        headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
      })
      const location = { directory: project }
      await client.plugin.awaitActivation({ location })
      const agents = (await client.agent.list({ location })).data
      expect(agents.find((agent) => agent.id === "project_agent")?.description).toBe(
        enabled ? "legacy directory wins" : undefined,
      )
      expect(agents.find((agent) => agent.id === "team/helper")?.description).toBe(
        enabled ? "Lower priority markdown agent" : undefined,
      )
      expect(agents.find((agent) => agent.id === "precedence")?.description).toBe(
        enabled ? "Legacy directory markdown agent" : undefined,
      )
      expect(agents.find((agent) => agent.id === "legacy")?.description).toBe(enabled ? "V1 markdown agent" : undefined)
      expect(agents.find((agent) => agent.id === "legacy")?.model).toEqual(
        enabled ? { providerID: "anthropic", id: "claude-sonnet" } : undefined,
      )
      expect(agents.some((agent) => agent.id === "malformed" || agent.id === "reachable")).toBe(false)
      expect(agents.some((agent) => agent.id === "home_leak" || agent.id === "upstream_leak")).toBe(false)
      const skills = (await client.skill.list({ location })).data
      expect(skills.some((skill) => skill.name === "local")).toBe(enabled)
      expect(skills.some((skill) => skill.name === "external-skill")).toBe(false)
      expect(await Bun.file(sentinel).exists()).toBe(false)
    } finally {
      child.kill("SIGTERM")
      expect(await child.exited, await errors).toBe(0)
    }
  }
  await boot(false)
  await boot(true)
  // A symlinked direct document cannot reintroduce ambient home config.
  const nested = path.join(project, "nested")
  await mkdir(nested)
  await symlink(path.join(input.home, "kilo.jsonc"), path.join(nested, "kilo.jsonc"))
  await Bun.write(
    path.join(nested, "kilo.json"),
    JSON.stringify({ skills: ["https://skills.example.test/index.json"] }),
  )
  const { readProjectEntries } = await import("../src/project-config")
  const { Effect, Layer } = await import("effect")
  const entries = await Effect.runPromise(
    readProjectEntries(nested, project).pipe(Effect.provide(FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer)))),
  )
  expect(entries.some((entry) => entry.type === "document" && entry.info.agents?.home_leak)).toBe(false)
  expect(
    entries.some(
      (entry) => entry.type === "document" && entry.info.skills?.includes("https://skills.example.test/index.json"),
    ),
  ).toBe(true)
}, 60000)
