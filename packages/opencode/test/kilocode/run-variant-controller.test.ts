import { describe, expect, test } from "bun:test"
import {
  createRunVariantController,
  createRunVariantGate,
  resolveRunAgent,
  resolveVariantAction,
} from "@/kilocode/cli/cmd/run/variant-controller"

const model = { providerID: "openai", modelID: "gpt-5" }
const other = { providerID: "anthropic", modelID: "claude" }

function primary(name: string, variant?: string, pinned?: typeof model) {
  return { name, mode: "primary" as const, variant, model: pinned }
}

function models() {
  return {
    variants: () => ["low", "high", "max"],
    label: (value: typeof model, variant: string | undefined) =>
      `${value.providerID}/${value.modelID}${variant ? `/${variant}` : ""}`,
    limits: {},
  }
}

describe("run variant controller", () => {
  test("readiness waits for agent and model catalogs", async () => {
    const agents = Promise.withResolvers<ReturnType<typeof primary>[]>()
    const catalog = Promise.withResolvers<ReturnType<typeof models>>()
    const ready = Promise.withResolvers<void>()
    const controller = createRunVariantController({
      agent: undefined,
      model,
      cli: undefined,
      session: undefined,
      agents: agents.promise,
      models: catalog.promise,
      update: async () => {},
    })
    let resolved = false
    void controller.ready.then(() => {
      resolved = true
      ready.resolve()
    })

    agents.resolve([primary("build", "high")])
    await Promise.resolve()
    expect(resolved).toBe(false)

    catalog.resolve(models())
    await ready.promise
    expect(controller.current()).toMatchObject({ agent: "build", display: "high", prompt: "high" })
  })

  test("early new-session preparation uses configured agent and variant", async () => {
    const agents = Promise.withResolvers<ReturnType<typeof primary>[]>()
    const catalog = Promise.withResolvers<ReturnType<typeof models>>()
    const controller = createRunVariantController({
      agent: undefined,
      model,
      cli: undefined,
      session: undefined,
      agents: agents.promise,
      models: catalog.promise,
      update: async () => {},
    })
    const prepared = controller.prepare()

    agents.resolve([primary("build", "default")])
    catalog.resolve(models())

    expect(await prepared).toEqual({ agent: "build", model, variant: "default" })
    expect(controller.current().display).toBeUndefined()
  })

  test("rapid variant writes are serialized", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const firstStarted = Promise.withResolvers<void>()
    const secondStarted = Promise.withResolvers<void>()
    const writes: unknown[] = []
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: undefined,
      agents: Promise.resolve([primary("build", "low")]),
      models: Promise.resolve(models()),
      update: (config: unknown) => {
        writes.push(config)
        if (writes.length === 1) {
          firstStarted.resolve()
          return first.promise
        }
        secondStarted.resolve()
        return second.promise
      },
    })
    await controller.ready

    const high = controller.select("high")
    await firstStarted.promise
    const max = controller.select("max")
    expect(writes).toHaveLength(1)

    first.resolve()
    await secondStarted.promise
    expect(writes).toHaveLength(2)
    second.resolve()
    await Promise.all([high, max])
    expect(controller.current().prompt).toBe("max")
  })

  test("failed writes retain prior state and report status", async () => {
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: undefined,
      agents: Promise.resolve([primary("build", "low")]),
      models: Promise.resolve(models()),
      update: () => Promise.reject(new Error("write failed")),
    })
    await controller.ready

    const result = await controller.select("high")

    expect(result).toMatchObject({ failed: true, status: "failed to save variant for build", variant: "low" })
    expect(controller.current()).toMatchObject({ display: "low", prompt: "low" })
  })

  test("invalid and subagent-only agents fall back to the default catalog agent", async () => {
    const writes: unknown[] = []
    const list = [primary("build", "low"), { name: "task", mode: "subagent" as const, variant: "max" }]
    const invalid = createRunVariantController({
      agent: "missing",
      model,
      cli: undefined,
      session: undefined,
      agents: Promise.resolve(list),
      models: Promise.resolve(models()),
      update: async (config: unknown) => {
        writes.push(config)
      },
    })
    const subagent = createRunVariantController({
      agent: "task",
      model,
      cli: undefined,
      session: undefined,
      agents: Promise.resolve(list),
      models: Promise.resolve(models()),
      update: async () => {},
    })
    await Promise.all([invalid.ready, subagent.ready])

    await invalid.resolveAgent({ type: "rejected" })
    await invalid.select("high")

    expect(invalid.current().agent).toBe("build")
    expect(subagent.current().agent).toBe("build")
    expect(writes).toEqual([{ agent: { build: { variant: "high" } } }])
  })

  test("rejected agent catalog preserves the requested agent", async () => {
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: "default",
      agents: Promise.reject(new Error("catalog unavailable")),
      models: Promise.resolve(models()),
      update: async () => {},
    })

    await expect(controller.ready).resolves.toBeUndefined()
    expect(await controller.prepare()).toEqual({ agent: "build", model, variant: "default" })
  })

  test("empty agent catalog preserves the requested and deferred agents", async () => {
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: "default",
      agents: Promise.resolve([]),
      models: Promise.resolve(models()),
      update: async () => {},
    })
    await controller.ready

    expect(controller.current().agent).toBe("build")
    await controller.switchAgent("review")
    expect(controller.current().agent).toBe("review")
  })

  test("rejected deferred agent clears an explicit agent when the catalog failed", async () => {
    const controller = createRunVariantController({
      agent: "missing",
      model,
      cli: undefined,
      session: "default",
      agents: Promise.reject(new Error("catalog unavailable")),
      models: Promise.resolve(models()),
      update: async () => {},
    })
    await controller.ready

    await controller.resolveAgent({ type: "rejected" })

    expect(await controller.prepare()).toEqual({ agent: undefined, model, variant: undefined })
  })

  test("runtime rejects an invalid deferred agent after the catalog fails", async () => {
    const controller = createRunVariantController({
      agent: "task",
      model,
      cli: undefined,
      session: "default",
      agents: Promise.reject(new Error("catalog unavailable")),
      models: Promise.resolve(models()),
      update: async () => {},
    })
    await controller.ready

    expect(resolveRunAgent("task", "build")).toEqual({ type: "resolved", agent: "build" })
    expect(resolveRunAgent("task", undefined)).toEqual({ type: "rejected" })
    expect(resolveRunAgent(undefined, undefined)).toEqual({ type: "none" })

    await controller.resolveAgent(resolveRunAgent("task", undefined))

    expect(await controller.prepare()).toEqual({ agent: undefined, model, variant: undefined })
  })

  test("runtime gate withholds telemetry session and prompt selection until rejection", async () => {
    const resolution = Promise.withResolvers<{ type: "rejected" }>()
    const controller = createRunVariantController({
      agent: "task",
      model,
      cli: undefined,
      session: "default",
      agents: Promise.reject(new Error("catalog unavailable")),
      models: Promise.resolve(models()),
      update: async () => {},
    })
    const gate = createRunVariantGate({
      controller,
      resolve: () => resolution.promise,
    })
    const seen: Array<string | undefined> = []
    const telemetry = gate.current().then((value) => seen.push(value.agent))
    const session = gate.prepare().then((value) => seen.push(value.agent))
    const prompt = gate.prepare().then((value) => seen.push(value.agent))

    await controller.ready
    await Promise.resolve()
    expect(seen).toEqual([])

    resolution.resolve({ type: "rejected" })
    await Promise.all([telemetry, session, prompt])

    expect(seen).toEqual([undefined, undefined, undefined])
  })

  test("attach gate waits for catalogs before telemetry and footer selection", async () => {
    const agents = Promise.withResolvers<ReturnType<typeof primary>[]>()
    const catalog = Promise.withResolvers<ReturnType<typeof models>>()
    const controller = createRunVariantController({
      agent: undefined,
      model,
      cli: undefined,
      session: undefined,
      agents: agents.promise,
      models: catalog.promise,
      update: async () => {},
    })
    const gate = createRunVariantGate({ controller })
    const seen: Array<ReturnType<typeof controller.current>> = []
    const telemetry = gate.current().then((value) => seen.push(value))
    const footer = gate.current().then((value) => seen.push(value))

    await Promise.resolve()
    expect(seen).toEqual([])

    agents.resolve([primary("build", "high")])
    await Promise.resolve()
    expect(seen).toEqual([])

    catalog.resolve(models())
    await Promise.all([telemetry, footer])

    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ agent: "build", model, display: "high", prompt: "high", variants: ["low", "high", "max"] })
    expect(seen[1]).toMatchObject({ agent: "build", model, display: "high", prompt: "high", variants: ["low", "high", "max"] })
  })

  test("absent deferred agent value preserves an explicit agent when the catalog failed", async () => {
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: "default",
      agents: Promise.reject(new Error("catalog unavailable")),
      models: Promise.resolve(models()),
      update: async () => {},
    })
    await controller.ready

    await controller.resolveAgent({ type: "none" })

    expect(await controller.prepare()).toEqual({ agent: "build", model, variant: "default" })
  })

  test("same-agent new session keeps resumed default for creation and first prompt", async () => {
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: "default",
      agents: Promise.resolve([primary("build", "high")]),
      models: Promise.resolve(models()),
      update: async () => {},
    })
    await controller.ready

    const creation = await controller.prepare()
    await controller.switchAgent(creation.agent)
    const prompt = await controller.prepare()

    expect(creation).toEqual({ agent: "build", model, variant: "default" })
    expect(prompt).toEqual(creation)
    expect(controller.current()).toMatchObject({ display: undefined, prompt: "default" })
  })

  test("model and agent switches discard stale successful mutations", async () => {
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: undefined,
      agents: Promise.resolve([primary("build", "low"), primary("review", "max")]),
      models: Promise.resolve(models()),
      update: () => {
        started.resolve()
        return release.promise
      },
    })
    await controller.ready
    const pending = controller.select("high")
    await started.promise

    await controller.switchModel(other)
    await controller.switchAgent("review")
    release.resolve()

    expect(await pending).toMatchObject({ stale: true })
    expect(controller.current()).toMatchObject({ agent: "review", model: other, display: "max", prompt: "max" })
  })

  test("stale successful saves update the saved agent catalog without changing the active context", async () => {
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const controller = createRunVariantController({
      agent: "code",
      model,
      cli: undefined,
      session: undefined,
      agents: Promise.resolve([primary("code", "low", model), primary("review", "max", model)]),
      models: Promise.resolve(models()),
      update: () => {
        started.resolve()
        return release.promise
      },
    })
    await controller.ready
    const pending = controller.select("high")
    await started.promise

    await controller.switchAgent("review")
    release.resolve()

    expect(await pending).toMatchObject({ stale: true })
    expect(controller.current()).toMatchObject({ agent: "review", display: "max", prompt: "max" })
    await controller.switchAgent("code")
    expect(controller.current()).toMatchObject({ agent: "code", display: "high", prompt: "high" })
  })

  test("concurrent model switch preserves failed persistence status", async () => {
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: undefined,
      agents: Promise.resolve([primary("build", "low")]),
      models: Promise.resolve(models()),
      update: () => {
        started.resolve()
        return release.promise.then(() => Promise.reject(new Error("write failed")))
      },
    })
    await controller.ready
    const pending = controller.select("high")
    await started.promise
    await controller.switchModel(other)
    release.resolve()

    const action = await resolveVariantAction({
      action: () => pending,
      stale: () => true,
      empty: "no variants available",
      failure: "failed to update variant",
    })

    expect(action).toEqual({ status: "failed to save variant for build" })
    expect(controller.current().model).toEqual(other)
  })
})

describe("run footer variant action", () => {
  test("awaits promise-aware cycle results", async () => {
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    let settled = false
    const controller = createRunVariantController({
      agent: "build",
      model,
      cli: undefined,
      session: undefined,
      agents: Promise.resolve([primary("build", "low")]),
      models: Promise.resolve(models()),
      update: () => {
        started.resolve()
        return release.promise
      },
    })
    await controller.ready
    const action = resolveVariantAction({
      action: () => controller.cycle(),
      stale: () => false,
      empty: "no variants available",
      failure: "failed to update variant",
    }).then((result) => {
      settled = true
      return result
    })

    await started.promise
    expect(settled).toBe(false)
    expect(controller.current().prompt).toBe("low")
    release.resolve()

    expect(await action).toMatchObject({ result: { status: "variant high", variant: "high" } })
    expect(controller.current().prompt).toBe("high")
  })

  test("discards stale success but keeps stale failure status", async () => {
    const success = await resolveVariantAction({
      action: async () => ({ status: "variant high", variant: "high" }),
      stale: () => true,
      empty: "no variants available",
      failure: "failed to update variant",
    })
    const failure = await resolveVariantAction({
      action: async () => ({ failed: true, stale: true, status: "failed to save variant for build" }),
      stale: () => true,
      empty: "no variants available",
      failure: "failed to update variant",
    })

    expect(success).toEqual({})
    expect(failure).toEqual({ status: "failed to save variant for build" })
  })
})
