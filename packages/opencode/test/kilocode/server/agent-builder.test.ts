import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import { GlobalBus, type GlobalEvent } from "../../../src/bus/global"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

type Output = {
  id: string
  scope: "global" | "project"
  path: string
  markdown: string
}

type Agent = {
  name: string
  mode: "primary" | "subagent" | "all"
  prompt: string
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function req(dir: string, input: string, init?: RequestInit) {
  return Server.Default().app.request(input, {
    ...init,
    headers: {
      "x-kilo-directory": dir,
      ...init?.headers,
    },
  })
}

function app(_value: boolean) {
  return Server.Default().app
}

function request(target: ReturnType<typeof app>, dir: string, input: string, init?: RequestInit) {
  return target.request(input, {
    ...init,
    headers: {
      "x-kilo-directory": dir,
      ...init?.headers,
    },
  })
}

describe("agent builder routes", () => {
  test("previews and saves project agent markdown", async () => {
    await using tmp = await tmpdir()
    const body = {
      id: "reviewer",
      scope: "project",
      description: "Review code",
      mode: "subagent",
      model: "kilo/gpt-5.5",
      tools: ["read", "grep"],
      prompt: "Review the current diff and report risks.",
    }

    const preview = await req(tmp.path, "/agent-builder/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

    expect(preview.status).toBe(200)
    const draft = (await preview.json()) as Output
    expect(draft.markdown).toContain('description: "Review code"')
    expect(draft.markdown).toContain('mode: "subagent"')
    expect(draft.markdown).toContain('permission: {"read":"allow","grep":"allow"}')

    const saved = await req(tmp.path, "/agent-builder/reviewer", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

    expect(saved.status).toBe(200)
    const output = (await saved.json()) as Output
    expect(output.path).toBe(path.join(tmp.path, ".kilo", "agent", "reviewer.md"))
    expect(await Bun.file(output.path).text()).toBe(output.markdown)

    const agents = (await (await req(tmp.path, "/agent")).json()) as Agent[]
    expect(agents.find((item) => item.name === "reviewer")).toMatchObject({
      mode: "subagent",
      prompt: "Review the current diff and report risks.",
    })
  })

  test("saves without a duplicated body id", async () => {
    await using tmp = await tmpdir()
    const saved = await req(tmp.path, "/agent-builder/canonical", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "project",
        prompt: "Use the route id for storage.",
      }),
    })

    expect(saved.status).toBe(200)
    const output = (await saved.json()) as Output
    expect(output.id).toBe("canonical")
    expect(output.path).toBe(path.join(tmp.path, ".kilo", "agent", "canonical.md"))
    expect(await Bun.file(output.path).exists()).toBe(true)
  })

  test("rejects whitespace-only prompts", async () => {
    await using tmp = await tmpdir()
    const preview = await req(tmp.path, "/agent-builder/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "empty",
        scope: "project",
        prompt: "   ",
      }),
    })

    expect(preview.status).toBe(400)
  })

  for (const value of [false, true]) {
    test.serial(`${value ? "httpapi" : "legacy"} rejects whitespace-only prompts when saving`, async () => {
      await using tmp = await tmpdir()
      const saved = await request(app(value), tmp.path, "/agent-builder/empty", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "project",
          prompt: "   ",
        }),
      })

      expect(saved.status).toBe(400)
    })

    test.serial(`${value ? "httpapi" : "legacy"} rejects invalid route ids`, async () => {
      await using tmp = await tmpdir()
      const saved = await request(app(value), tmp.path, "/agent-builder/bad:id", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "project",
          prompt: "Do not write invalid ids.",
        }),
      })

      expect(saved.status).toBe(400)
      expect(await Bun.file(path.join(tmp.path, ".kilo", "agent", "bad:id.md")).exists()).toBe(false)
    })
  }

  // Regression: saving must dispose the instance so open TUIs hot-reload the agent list. The
  // dispose is the reload trigger — the server agent cache is keyed by config
  // (KiloAgent.cacheKey), not file-based `.md` agents, so without it a new agent would not
  // surface until restart. The TUI reacts to `server.instance.disposed` by re-bootstrapping and
  // refetching `app.agents`.
  test("disposes the instance after save so open TUIs hot-reload agents", async () => {
    await using tmp = await tmpdir()

    const events: GlobalEvent[] = []
    const handler = (event: GlobalEvent) => events.push(event)
    GlobalBus.on("event", handler)
    try {
      const saved = await req(tmp.path, "/agent-builder/hotreload", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", prompt: "Hot reload me." }),
      })
      expect(saved.status).toBe(200)
    } finally {
      GlobalBus.off("event", handler)
    }

    expect(events.some((event) => event.payload?.type === "server.instance.disposed")).toBe(true)

    // After the dispose, the next request rebuilds the instance and re-reads the agent files.
    const agents = (await (await req(tmp.path, "/agent")).json()) as Agent[]
    expect(agents.some((item) => item.name === "hotreload")).toBe(true)
  })
})
