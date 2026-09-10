import { expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import { Permission } from "@opencode-ai/core/permission"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { ToolEditor } from "@opencode-ai/plugin/effect/tool"
import type { Tool } from "@opencode-ai/schema/tool"
import { Effect } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import type { Layout } from "../src/paths"
import { createPlanPolicy } from "../src/plan-policy"
import { fixture } from "./fixture"

const approvedPlan = ".kilo/plans/approved.md"

test("Kilo Plan uses the native question form and only implements after Continue here", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(interactiveLayout(input.directory, input.home), plan, async (host) => {
    await host.client.plugin.awaitActivation({ location: { directory: input.cwd } })
    const planAgent = (await host.client.agent.list({ location: { directory: input.cwd } })).data.find(
      (agent) => agent.id === "plan",
    )
    expect(planAgent).toBeDefined()
    expect(Permission.evaluate("edit", approvedPlan, planAgent!.permissions).effect).toBe("allow")
    expect(
      Permission.evaluate("edit", path.join(input.cwd, ".kilo", "plans", "approved.md"), planAgent!.permissions).effect,
    ).toBe("deny")
    expect(Permission.evaluate("edit", "src/index.ts", planAgent!.permissions).effect).toBe("deny")
    expect(Permission.evaluate("shell", "git status", planAgent!.permissions).effect).toBe("deny")
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      agent: "plan",
      model: { providerID: "fixture", id: "chat" },
    })
    await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
    const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
    expect(form).toMatchObject({ title: "Questions", metadata: { kind: "question" } })
    expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
    expect(host.calls()).toBeGreaterThanOrEqual(1)

    await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { q0: "Continue here" } })
    await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
    expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("build")
    expect(JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)).toContain(plan)
  })
}, 20_000)

test("Kilo Plan saves a new plan file through a real write before plan_exit", async () => {
  await using input = await fixture()
  const content = "# Fresh plan\n\n1. Ship the fix.\n"
  const freshPlan = `.kilo/plans/${Date.now()}-fresh-plan.md`
  await withHost(
    interactiveLayout(input.directory, input.home),
    freshPlan,
    async (host) => {
      await host.client.plugin.awaitActivation({ location: { directory: input.cwd } })
      const planAgent = (await host.client.agent.list({ location: { directory: input.cwd } })).data.find(
        (agent) => agent.id === "plan",
      )
      expect(Permission.evaluate("edit", freshPlan, planAgent!.permissions).effect).toBe("allow")
      const session = await host.client.session.create({
        location: { directory: input.cwd },
        agent: "plan",
        model: { providerID: "fixture", id: "chat" },
      })
      await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
      const save = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
      expect(save).toMatchObject({ title: "Questions", metadata: { kind: "question" } })
      expect(host.tools()).toEqual(expect.arrayContaining(["write", "edit"]))
      await host.client.form.reply({
        sessionID: session.id,
        formID: save.id,
        answer: { q0: "Finalize and save the plan" },
      })
      const implement = await waitFor(async () => {
        const form = (await host.client.form.list({ sessionID: session.id })).at(0)
        return form && form.id !== save.id ? form : undefined
      })
      expect(implement).toMatchObject({ title: "Questions", metadata: { kind: "question" } })
      expect(await Bun.file(path.join(input.cwd, freshPlan)).text()).toBe(content)
      expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
      expect(host.system()).toContain("Finalize and save the plan")
      expect(host.system()).toContain("use the native question tool")
      expect(host.system()).toContain("one permitted exception")
      expect(host.system()).toMatch(/\d{13}-<short-kebab-case-description>\.md/)
      expect(host.system()).not.toContain("{{timestamp}}")
      await host.client.form.reply({
        sessionID: session.id,
        formID: implement.id,
        answer: { q0: "Continue here" },
      })
      await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
      expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("build")
      const messages = JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)
      expect(messages).toContain("Implement the approved plan at")
      expect(messages).toContain("fresh-plan.md")
    },
    {},
    [
      {
        name: "question",
        arguments: {
          questions: [
            {
              header: "Save plan",
              question: "Save the finalized plan?",
              options: [
                { label: "Finalize and save the plan", description: "Write the plan file" },
                { label: "Continue refining", description: "Keep planning without saving" },
              ],
            },
          ],
        },
      },
      { name: "write", arguments: { path: freshPlan, content } },
      { name: "plan_exit", arguments: { path: freshPlan } },
    ],
  )
}, 20_000)

test("Kilo Plan save cancellation keeps the plan unsaved and the session planning", async () => {
  await using input = await fixture()
  await withHost(interactiveLayout(input.directory, input.home), approvedPlan, async (host) => {
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      agent: "plan",
      model: { providerID: "fixture", id: "chat" },
    })
    await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
    const save = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
    await host.client.form.cancel({ sessionID: session.id, formID: save.id })
    await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
    expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
    await expect(Bun.file(path.join(input.cwd, approvedPlan)).exists()).resolves.toBe(false)
    const messages = JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)
    expect(messages).not.toContain("Implement the approved plan")
  }, undefined, [
    {
      name: "question",
      arguments: {
        questions: [
          {
            header: "Save plan",
            question: "Save the finalized plan?",
            options: [
              { label: "Finalize and save the plan", description: "Write the plan file" },
              { label: "Continue refining", description: "Keep planning without saving" },
            ],
          },
        ],
      },
    },
  ])
}, 20_000)

test("Kilo Plan cannot complete without a saved plan file", async () => {
  await using input = await fixture()
  await mkdir(path.join(input.cwd, ".kilo", "plans"), { recursive: true })
  await withHost(interactiveLayout(input.directory, input.home), approvedPlan, async (host) => {
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      agent: "plan",
      model: { providerID: "fixture", id: "chat" },
    })
    await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
    await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
    expect(await host.client.form.list({ sessionID: session.id })).toEqual([])
    const messages = JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)
    expect(messages).toContain(
      `Plan file does not exist yet; save the plan to ${approvedPlan} before calling plan_exit`,
    )
    expect(messages).not.toContain("Implement the approved plan")
    expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
  })
}, 20_000)

test("Kilo Plan denial outside the plan directory leaves the tree untouched", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(
    interactiveLayout(input.directory, input.home),
    plan,
    async (host) => {
      const session = await host.client.session.create({
        location: { directory: input.cwd },
        agent: "plan",
        model: { providerID: "fixture", id: "chat" },
      })
      await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
      const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
      await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { q0: "Keep refining" } })
      await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
      expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
      const messages = JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)
      expect(messages).toContain("Permission denied: edit")
      await expect(Bun.file(path.join(input.cwd, "src", "leak.ts")).exists()).resolves.toBe(false)
      expect(messages).not.toContain("Implement the approved plan")
    },
    {},
    [
      { name: "write", arguments: { path: "src/leak.ts", content: "export const leaked = true\n" } },
      { name: "plan_exit", arguments: { path: approvedPlan } },
    ],
  )
}, 20_000)

test("a configured global edit deny keeps winning over the Plan save allowance", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(
    interactiveLayout(input.directory, input.home),
    plan,
    async (host) => {
      await host.client.plugin.awaitActivation({ location: { directory: input.cwd } })
      const planAgent = (await host.client.agent.list({ location: { directory: input.cwd } })).data.find(
        (agent) => agent.id === "plan",
      )
      expect(Permission.evaluate("edit", approvedPlan, planAgent!.permissions).effect).toBe("deny")
      const session = await host.client.session.create({
        location: { directory: input.cwd },
        agent: "plan",
        model: { providerID: "fixture", id: "chat" },
      })
      await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
      const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
      await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { q0: "Keep refining" } })
      await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
      expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
      const messages = JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)
      expect(messages).toContain("Permission denied: edit")
      expect(await Bun.file(path.join(input.cwd, approvedPlan)).text()).toBe(
        "# Approved plan\n\n1. Implement the change.\n",
      )
    },
    { permissions: [{ action: "edit", resource: "*.md", effect: "deny" }] },
    [
      { name: "write", arguments: { path: approvedPlan, content: "# Overwritten\n" } },
      { name: "plan_exit", arguments: { path: approvedPlan } },
    ],
  )
}, 20_000)

test("Kilo Plan cancellation leaves the planning session untouched", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(interactiveLayout(input.directory, input.home), plan, async (host) => {
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      agent: "plan",
      model: { providerID: "fixture", id: "chat" },
    })
    await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
    const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
    await host.client.form.cancel({ sessionID: session.id, formID: form.id })
    await waitFor(async () =>
      (await host.client.form.list({ sessionID: session.id })).length === 0 ? true : undefined,
    )
    expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
    expect(JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)).not.toContain(
      "Implement the approved plan",
    )
  })
}, 20_000)

test("Kilo Plan fails closed when the host omits plan_exit authorization", async () => {
  let planExit: Tool.Info | undefined
  const build = { permissions: [] }
  const context = {
    location: { directory: "/tmp/kilo-plan-policy" },
    agent: {
      transform: (callback: Parameters<Context["agent"]["transform"]>[0]) =>
        Effect.sync(() =>
          callback({
            get: (id: string) => (id === "build" ? build : undefined),
            update: (_id: string, update: (agent: { permissions: never[] }) => void) => update({ permissions: [] }),
          } as never),
        ),
    },
    tool: {
      transform: (callback: Parameters<Context["tool"]["transform"]>[0]) =>
        Effect.sync(() =>
          callback({
            get: () => undefined,
            add: (tool: Tool.Info) => {
              planExit = tool
            },
          } as unknown as ToolEditor),
        ),
    },
  } as unknown as Context
  await Effect.runPromise(Effect.scoped(createPlanPolicy().effect(context)))
  await expect(
    Effect.runPromise(
      planExit!.execute({ path: ".kilo/plans/approved.md" }, {
        sessionID: "ses_plan",
        agent: "plan",
        messageID: "msg_plan",
        id: "call_plan",
        progress: () => Effect.void,
      } as never),
    ),
  ).rejects.toMatchObject({ message: "Tool authorization is unavailable" })
})

test("Kilo Plan starts a code session only after Start new session", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(interactiveLayout(input.directory, input.home), plan, async (host) => {
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      agent: "plan",
      model: { providerID: "fixture", id: "selected" },
    })
    await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
    const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
    expect((await host.client.session.list({ directory: input.cwd })).data).toHaveLength(1)
    await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { q0: "Start new session" } })
    const next = await waitFor(async () => {
      const sessions = (await host.client.session.list({ directory: input.cwd })).data
      return sessions.find((item) => item.id !== session.id)
    })
    await host.client.session.wait({ sessionID: next.id }, { signal: AbortSignal.timeout(10_000) })
    await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
    const sourceMessages = JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)
    expect(sourceMessages).toContain('"kiloPlanHandoff":{"sessionID":"' + next.id + '"}')
    expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
    expect(next.agent).toBe("build")
    expect(next.model).toMatchObject({ providerID: "fixture", id: "selected" })
    expect(JSON.stringify((await host.client.message.list({ sessionID: next.id })).data)).toContain(plan)
  })
}, 20_000)

test("Kilo Plan keeps refining after the native completion form", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(interactiveLayout(input.directory, input.home), plan, async (host) => {
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      agent: "plan",
      model: { providerID: "fixture", id: "chat" },
    })
    await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
    const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
    await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { q0: "Keep refining" } })
    await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
    expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
    expect(JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)).not.toContain(
      "Implement the approved plan",
    )
  })
}, 20_000)

test("Kilo Plan rejects free-form completion answers without leaving Plan mode", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(interactiveLayout(input.directory, input.home), plan, async (host) => {
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      agent: "plan",
      model: { providerID: "fixture", id: "chat" },
    })
    await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
    const form = await waitFor(async () => (await host.client.form.list({ sessionID: session.id })).at(0))
    await host.client.form.reply({ sessionID: session.id, formID: form.id, answer: { q0: "Implement everything now" } })
    await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
    expect((await host.client.session.get({ sessionID: session.id })).agent).toBe("plan")
    const messages = JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)
    expect(messages).toContain("requires one of the listed completion choices")
    expect(messages).not.toContain("Implement the approved plan")
  })
}, 20_000)

test("Kilo Plan carries configured plan_exit denials into the native Plan agent", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(
    interactiveLayout(input.directory, input.home),
    plan,
    async (host) => {
      await host.client.plugin.awaitActivation({ location: { directory: input.cwd } })
      const agent = (await host.client.agent.list({ location: { directory: input.cwd } })).data.find(
        (item) => item.id === "plan",
      )
      expect(Permission.evaluate("plan_exit", "*", agent!.permissions).effect).toBe("deny")
      const session = await host.client.session.create({
        location: { directory: input.cwd },
        agent: "plan",
        model: { providerID: "fixture", id: "chat" },
      })
      await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
      await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
      expect(await host.client.form.list({ sessionID: session.id })).toEqual([])
      expect(JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)).toContain(
        "Unknown tool: plan_exit",
      )
    },
    { permissions: [{ action: "plan_exit", resource: "*", effect: "deny" }] },
  )
}, 20_000)

test("Kilo Plan rejects invalid saved paths and calls from non-Plan agents without opening a form", async () => {
  await using input = await fixture()
  await mkdir(path.join(input.cwd, ".kilo", "plans"), { recursive: true })
  for (const agent of ["plan", "build"]) {
    await withHost(interactiveLayout(input.directory, input.home), "outside.md", async (host) => {
      const session = await host.client.session.create({
        location: { directory: input.cwd },
        agent,
        model: { providerID: "fixture", id: "chat" },
      })
      await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
      await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
      expect(await host.client.form.list({ sessionID: session.id })).toEqual([])
      const messages = JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)
      expect(messages).toContain(
        agent === "plan" ? "Plan file must be under this project's .kilo/plans directory" : "built-in Plan agent",
      )
    })
  }
}, 20_000)

test("a configured Plan agent remains authoritative and cannot use Kilo's native handoff", async () => {
  await using input = await fixture()
  const plan = await savedPlan(input.cwd)
  await withHost(
    interactiveLayout(input.directory, input.home),
    plan,
    async (host) => {
      await host.client.plugin.awaitActivation({ location: { directory: input.cwd } })
      const configured = (await host.client.agent.list({ location: { directory: input.cwd } })).data.find(
        (agent) => agent.id === "plan",
      )
      expect(configured).toMatchObject({ system: "Project Plan prompt wins." })
      expect(Permission.evaluate("question", "*", configured!.permissions).effect).toBe("deny")
      const session = await host.client.session.create({
        location: { directory: input.cwd },
        agent: "plan",
        model: { providerID: "fixture", id: "chat" },
      })
      await host.client.session.prompt({ sessionID: session.id, text: "Make a plan" })
      await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
      expect(await host.client.form.list({ sessionID: session.id })).toEqual([])
      expect(JSON.stringify((await host.client.message.list({ sessionID: session.id })).data)).toContain(
        "built-in Plan agent",
      )
    },
    {
      agents: {
        plan: {
          system: "Project Plan prompt wins.",
          permissions: [{ action: "question", resource: "*", effect: "deny" }],
        },
      },
    },
  )
}, 20_000)

async function savedPlan(directory: string) {
  const file = path.join(directory, ".kilo", "plans", "approved.md")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, "# Approved plan\n\n1. Implement the change.\n")
  return approvedPlan
}

function interactiveLayout(root: string, home: string): Layout {
  const paths = {
    home,
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

type Step = { readonly name: string; readonly arguments: unknown }

async function withHost(
  layout: Parameters<typeof launch>[0],
  plan: string,
  run: (host: {
    readonly client: ReturnType<typeof OpenCode.make>
    readonly calls: () => number
    readonly tools: () => string[]
    readonly system: () => string
  }) => Promise<void>,
  config: object = {},
  steps?: readonly Step[],
) {
  let requests = 0
  const systems = new Set<string>()
  const queue = [...(steps ?? [{ name: "plan_exit", arguments: { path: plan } }])]
  const requested = new Set<string>()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = (await request.json()) as {
        stream?: boolean
        tools?: Array<{ function?: { name?: string } }>
        messages?: Array<{ role?: string; content?: unknown }>
      }
      if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "fixture" } }] })
      requests++
      const message = body.messages?.find((item) => item.role === "system")
      if (message) systems.add(JSON.stringify(message.content))
      for (const tool of body.tools ?? []) {
        const name = tool.function?.name
        if (name) requested.add(name)
      }
      const advertised = Array.isArray(body.tools) && body.tools.length > 0
      const step = advertised ? queue.shift() : undefined
      const tool = step ? { name: step.name, arguments: JSON.stringify(step.arguments) } : undefined
      return completion(tool)
    },
  })
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              ...config,
              model: "fixture/chat",
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `${model.url.origin}/v1`, apiKey: "fixture" },
                  models: { chat: {}, selected: {} },
                },
              },
            }),
          })
          yield* Effect.promise(() =>
            run({
              client: OpenCode.make({
                baseUrl: server.url,
                headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
              }),
              calls: () => requests,
              tools: () => [...requested],
              system: () => [...systems].find((text) => text.includes("Native Plan Mode")) ?? "",
            }),
          )
        }),
      ),
    )
  } finally {
    await model.stop(true)
  }
}

function completion(tool?: { readonly name: string; readonly arguments: string }) {
  const delta = tool
    ? { tool_calls: [{ index: 0, id: "call_plan_exit", type: "function", function: tool }] }
    : { role: "assistant", content: "Fixture complete" }
  const finish = tool ? "tool_calls" : "stop"
  return new Response(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: finish }] },
    ]
      .map(
        (frame) =>
          `data: ${JSON.stringify({ id: "plan-policy", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

async function waitFor<T>(fn: () => Promise<T | undefined>, milliseconds = 8_000): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < milliseconds) {
    const value = await fn()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`waitFor timed out after ${milliseconds}ms`)
}
