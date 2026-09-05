import { expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import path from "node:path"
import { mkdir, symlink } from "node:fs/promises"
import { fixture, ready, type Fixture } from "./fixture"
import { run } from "../src/run"

type Completion = {
  stream?: boolean
  messages: { role: string; content?: unknown }[]
}

function answer(content: string, tool?: { name: string; arguments: string }) {
  const delta = tool
    ? { tool_calls: [{ index: 0, id: "call_skill_shell", type: "function", function: tool }] }
    : { role: "assistant", content }
  const frames = [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] },
  ]
  return new Response(
    frames
      .map(
        (frame) =>
          `data: ${JSON.stringify({ id: "skill-shell-proof", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

async function boot(
  input: Fixture,
  baseURL: string,
  permissions: { action: string; resource: string; effect: "allow" | "deny" }[],
) {
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")], {
    cwd: input.cwd,
    env: {
      ...input.env,
      KILO_FIXTURE_CONFIG: JSON.stringify({
        model: "fixture/chat",
        permissions,
        providers: {
          fixture: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL, apiKey: "fixture" },
            models: { chat: {} },
          },
        },
      }),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  })
  const errors = new Response(child.stderr).text()
  try {
    const listening = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    const options = { baseUrl: listening.value, headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } }
    return {
      child,
      client: OpenCode.make(options),
      async [Symbol.asyncDispose]() {
        child.kill("SIGTERM")
        await child.exited
      },
      errors,
    }
  } catch (error) {
    child.kill("SIGTERM")
    await child.exited
    throw new Error(`Interactive boot failed: ${await errors}`, { cause: error })
  }
}

test("trusted skill shell uses one real Form and native shell output", async () => {
  await using input = await fixture()
  const skill = await writeSkill(input, "trusted-fixture", false)
  await using model = await modelServer("trusted-fixture", "trusted skill complete")
  await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
    { action: "skill", resource: "trusted-fixture", effect: "allow" },
    { action: "shell", resource: "*", effect: "allow" },
  ])
  const session = await host.client.session.create({
    location: { directory: input.cwd },
    model: { providerID: "fixture", id: "chat" },
  })
  await host.client.session.prompt({ sessionID: session.id, text: "Load the trusted skill" })
  const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
  expect(form?.title).toContain("trusted-fixture")
  expect(form?.metadata).toMatchObject({ skillShell: true, commands: [skill.command] })
  await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { allow: true } })
  await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
  const messages = (await host.client.message.list({ sessionID: session.id })).data
  expect(JSON.stringify(messages)).toContain("trusted skill complete")
  const skillTool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .find((part) => part.type === "tool" && part.name === "skill")
  if (!skillTool || skillTool.type !== "tool" || skillTool.state.status !== "completed") {
    throw new Error(`Expected completed skill result: ${JSON.stringify(skillTool)}`)
  }
  const skillOutput = skillTool.state.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  expect(skillOutput).toContain("trusted-fixture-skill-output")
  expect(skillOutput).not.toContain("!`")
  expect(await Bun.file(path.join(input.cwd, "trusted-fixture.txt")).text()).toBe("trusted-output")
})

test("skill shell rejection and native deny never execute the source command", async () => {
  for (const scenario of [
    {
      name: "rejected-fixture",
      permissions: [
        { action: "skill", resource: "rejected-fixture", effect: "allow" as const },
        { action: "shell", resource: "*", effect: "allow" as const },
      ],
      answer: false,
    },
    {
      name: "denied-fixture",
      permissions: [
        { action: "skill", resource: "denied-fixture", effect: "allow" as const },
        { action: "shell", resource: "*", effect: "deny" as const },
      ],
      answer: undefined,
    },
  ]) {
    await using input = await fixture()
    const skill = await writeSkill(input, scenario.name, false)
    await using model = await modelServer(scenario.name)
    await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, scenario.permissions)
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      model: { providerID: "fixture", id: "chat" },
    })
    await host.client.session.prompt({ sessionID: session.id, text: `Load ${scenario.name}` })
    if (scenario.answer !== undefined) {
      const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
      await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { allow: scenario.answer } })
    }
    await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
    expect(JSON.stringify(await host.client.message.list({ sessionID: session.id }))).toContain(
      `${scenario.name} observed`,
    )
    expect(await Bun.file(path.join(input.cwd, `${scenario.name}.txt`)).exists()).toBe(false)
    expect(await Bun.file(path.join(input.cwd, "skill-shell-proof.txt")).exists()).toBe(false)
    expect(skill.command).toContain(scenario.name)
  }
})

test("headless auto cancels the forced skill shell Form", async () => {
  await using input = await fixture()
  await writeSkill(input, "headless-fixture", false)
  await using model = await modelServer("headless-fixture")
  await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
    { action: "skill", resource: "headless-fixture", effect: "allow" },
    { action: "shell", resource: "*", effect: "allow" },
  ])
  await expect(
    run(host.client, {
      directory: input.cwd,
      text: "Load the headless skill",
      model: { providerID: "fixture", id: "chat" },
      auto: true,
    }),
  ).rejects.toThrow("headless runs cannot answer forms")
  expect(await Bun.file(path.join(input.cwd, "headless-fixture.txt")).exists()).toBe(false)
})

test("a profile symlink resolving into the project remains untrusted", async () => {
  await using input = await fixture()
  const skill = await writeSkill(input, "project-fixture", true)
  await using model = await modelServer("project-fixture")
  await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
    { action: "skill", resource: "project-fixture", effect: "allow" },
    { action: "shell", resource: "*", effect: "allow" },
  ])
  const session = await host.client.session.create({
    location: { directory: input.cwd },
    model: { providerID: "fixture", id: "chat" },
  })
  await host.client.session.prompt({ sessionID: session.id, text: "Load the project skill" })
  await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
  expect(JSON.stringify(await host.client.message.list({ sessionID: session.id }))).toContain(
    "project-fixture observed",
  )
  expect(await host.client.form.list({ sessionID: session.id })).toEqual([])
  expect(await Bun.file(path.join(input.cwd, "project-fixture.txt")).exists()).toBe(false)
  expect(skill.command).toContain("project-fixture")
})

test("a project skill file symlink escaping its source root is not inventoried", async () => {
  await using input = await fixture()
  const root = path.join(input.cwd, "nested-project")
  const outside = path.join(input.directory, "nested-source")
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
  await Bun.write(
    path.join(outside, "SKILL.md"),
    "---\nname: nested-project\n---\nESCAPED_SKILL_BODY\n!`printf escaped-output > escaped-skill.txt`\n",
  )
  await symlink(path.join(outside, "SKILL.md"), path.join(root, "SKILL.md"))
  const profile = path.join(input.env.XDG_CONFIG_HOME, "kilo2/interactive/kilo.jsonc")
  await mkdir(path.dirname(profile), { recursive: true })
  await Bun.write(profile, JSON.stringify({ skills: [root] }))
  await using model = await modelServer("nested-project")
  await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
    { action: "skill", resource: "nested-project", effect: "allow" },
    { action: "shell", resource: "*", effect: "allow" },
  ])
  const scope = { location: { directory: input.cwd } }
  await host.client.plugin.awaitActivation(scope)
  const skills = await host.client.skill.list(scope)
  expect(skills.data.some((skill) => skill.id === "nested-project")).toBe(false)
  const session = await host.client.session.create({
    location: { directory: input.cwd },
    model: { providerID: "fixture", id: "chat" },
  })
  await host.client.session.prompt({ sessionID: session.id, text: "Load the nested project skill" })
  await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
  const messages = JSON.stringify(await host.client.message.list({ sessionID: session.id }))
  expect(messages).toContain("nested-project observed")
  expect(messages).not.toContain("ESCAPED_SKILL_BODY")
  expect(await host.client.form.list({ sessionID: session.id })).toEqual([])
  expect(await Bun.file(path.join(input.cwd, "escaped-skill.txt")).exists()).toBe(false)
})

test("a user session.skill activation keeps shell placeholders literal", async () => {
  await using input = await fixture()
  const skill = await writeSkill(input, "user-skill-fixture", false)
  await using model = await modelServer("user-skill-fixture")
  await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
    { action: "skill", resource: "user-skill-fixture", effect: "allow" },
    { action: "shell", resource: "*", effect: "allow" },
  ])
  const session = await host.client.session.create({
    location: { directory: input.cwd },
    model: { providerID: "fixture", id: "chat" },
  })
  await host.client.session.skill({ sessionID: session.id, skill: "user-skill-fixture", resume: false })
  const messages = (await host.client.message.list({ sessionID: session.id })).data
  const activated = messages.find((message) => message.type === "skill" && message.skill === "user-skill-fixture")
  if (!activated || activated.type !== "skill") throw new Error("Expected literal session.skill activation")
  expect(activated.text).toContain("!`")
  expect(activated.text).toContain(skill.command)
  expect(await host.client.form.list({ sessionID: session.id })).toEqual([])
  expect(await Bun.file(path.join(input.cwd, "user-skill-fixture.txt")).exists()).toBe(false)
})

test("skill shell preflights external directories before the forced form", async () => {
  await using input = await fixture()
  const skill = await writeSkill(
    input,
    "external-dir-fixture",
    false,
    "cd .. && printf external-output > external-dir-proof.txt",
  )
  await using model = await modelServer("external-dir-fixture")
  await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
    { action: "skill", resource: "external-dir-fixture", effect: "allow" },
    { action: "external_directory", resource: `${input.directory}/*`, effect: "allow" },
    { action: "shell", resource: "*", effect: "allow" },
  ])
  const session = await host.client.session.create({
    location: { directory: input.cwd },
    model: { providerID: "fixture", id: "chat" },
  })
  await host.client.session.prompt({ sessionID: session.id, text: "Load the external directory skill" })
  const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
  expect(form?.metadata).toMatchObject({
    skillShell: true,
    externalDirectories: [`${input.directory}/*`],
  })
  expect(form?.fields[0]?.description).toContain("External directories:")
  await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { allow: true } })
  await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
  expect(JSON.stringify(await host.client.message.list({ sessionID: session.id }))).toContain(
    "external-dir-fixture observed",
  )
  expect(await Bun.file(path.join(input.directory, "external-dir-proof.txt")).text()).toBe("external-output")
  expect(skill.command).toContain("cd ..")
})

async function writeSkill(input: Fixture, name: string, project: boolean, command?: string) {
  const root = project ? path.join(input.cwd, name) : path.join(input.directory, name)
  await mkdir(root, { recursive: true })
  const sourceCommand =
    command ?? `printf ${project ? "project-fixture" : "trusted-output"} > ${name}.txt && printf ${name}-skill-output`
  await Bun.write(path.join(root, "SKILL.md"), `---\nname: ${name}\n---\n!\`${sourceCommand}\`\n`)
  const profile = path.join(input.env.XDG_CONFIG_HOME, "kilo2/interactive/kilo.jsonc")
  await mkdir(path.dirname(profile), { recursive: true })
  const source = project ? path.join(input.directory, `${name}-link`) : root
  if (project) await symlink(root, source)
  await Bun.write(profile, JSON.stringify({ skills: [source] }))
  return { command: sourceCommand }
}

async function modelServer(skill?: string, completion?: string) {
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: Completion = await request.json()
      if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "fixture" } }] })
      if (body.messages.at(-1)?.role === "tool") return answer(completion ?? `${skill ?? "trusted skill"} observed`)
      return answer("", {
        name: "skill",
        arguments: JSON.stringify({ id: skill ?? "trusted-fixture" }),
      })
    },
  })
  return {
    port: model.port,
    [Symbol.asyncDispose]: () => model.stop(true),
  }
}

async function waitFor<T>(read: () => Promise<T | undefined>, milliseconds = 8000) {
  const started = Date.now()
  while (Date.now() - started < milliseconds) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`waitFor timed out after ${milliseconds}ms`)
}
