// Startup ratchet (#15244). It boots the server that the Kilo host starts, with a local Kilo API that answers
// after a fixed delay, and fails when Kilo plugin activation costs more than the budgets in startup-budget.json.
// Two measures stay stable on shared CI runners:
// - the activation time of each Kilo plugin: a plugin that waits for the network during activation shows the
//   fixture delay on every machine, a plugin that does not shows almost nothing;
// - the median time until all plugins of a Location are active with the host overrides, minus the median without
//   them. The runs alternate in one process, so the runner speed cancels out.
// The first run of each kind warms up the process and stores the Gateway catalog; it is not measured. The measured
// runs are later starts with the same database, as a user's second start is.
import { fixture } from "@kilocode/gateway-core/testing"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import budget from "../startup-budget.json"

// The server reads the global paths when its modules load, so isolate them before the dynamic imports.
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-startup-")))
process.env.OPENCODE_TEST_HOME = root
process.env.XDG_DATA_HOME = path.join(root, "data")
process.env.XDG_CONFIG_HOME = path.join(root, "config")
process.env.XDG_STATE_HOME = path.join(root, "state")
process.env.XDG_CACHE_HOME = path.join(root, "cache")
process.env.OPENCODE_DISABLE_AUTOUPDATE = "1"
const { createRoutes } = await import("@opencode/server/routes")
const { KiloHost } = await import("../src/host")

using backend = fixture()
backend.state.delay = budget.latency
process.env.KILO_API_URL = backend.url
const directory = path.join(root, "project")
await mkdir(directory)
const database = path.join(root, "opencode.db")

const boot = (overrides: LayerNode.Replacements) =>
  Effect.scoped(
    Effect.gen(function* () {
      KiloHost.activations.clear()
      const context = yield* Layer.build(
        createRoutes(
          {
            password: "secret",
            database: { path: database },
            models: { fetch: false },
            fs: { filewatcher: false },
            config: { directory, project: false },
          },
          () => [],
          overrides,
        ).pipe(Layer.provide(HttpServer.layerServices)),
      )
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const url = new URL("/api/model", "http://kilo.local")
      url.searchParams.set("location[directory]", directory)
      // The first request boots the Location. The model list answers after all its plugins are active.
      const start = performance.now()
      const response = yield* Effect.promise(() =>
        handler(new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } })),
      )
      const total = performance.now() - start
      if (response.status !== 200) return yield* Effect.die(new Error(`/api/model answered ${response.status}`))
      return { total, plugins: new Map(KiloHost.activations) }
    }),
  ).pipe(Effect.provideService(References.MinimumLogLevel, "Error"), Effect.runPromise)

await boot([])
await boot(KiloHost.overrides)
const samples: { upstream: number; host: number; plugins: Map<string, number> }[] = []
for (const _ of Array.from({ length: budget.runs })) {
  const upstream = await boot([])
  const host = await boot(KiloHost.overrides)
  samples.push({ upstream: upstream.total, host: host.total, plugins: host.plugins })
}
await rm(root, { recursive: true, force: true })

const ids = [...new Set(samples.flatMap((sample) => [...sample.plugins.keys()]))]
const plugins = ids.map((id) => ({
  id,
  median: median(samples.map((sample) => sample.plugins.get(id) ?? 0)),
  budget: (budget.plugins as Record<string, number | undefined>)[id],
}))
const overhead = median(samples.map((sample) => sample.host)) - median(samples.map((sample) => sample.upstream))
const failures = [
  ...plugins.flatMap((plugin) => {
    if (plugin.budget === undefined) return [`${plugin.id}: no budget in startup-budget.json`]
    if (plugin.median > plugin.budget)
      return [`${plugin.id}: ${ms(plugin.median)} is over its budget ${ms(plugin.budget)}`]
    return []
  }),
  ...Object.keys(budget.plugins)
    .filter((id) => !ids.includes(id))
    .map((id) => `${id}: has a budget but did not activate; remove it from startup-budget.json`),
  ...(overhead > budget.overhead ? [`host overhead: ${ms(overhead)} is over its budget ${ms(budget.overhead)}`] : []),
]

console.log(`Kilo startup ratchet: Kilo API delay ${budget.latency} ms, ${budget.runs} runs, medians`)
console.table([
  ...plugins.map((plugin) => ({ measure: plugin.id, median: ms(plugin.median), budget: ms(plugin.budget) })),
  { measure: "host overhead", median: ms(overhead), budget: ms(budget.overhead) },
])
console.log("samples (ms):")
console.log(`  upstream: ${samples.map((sample) => Math.round(sample.upstream)).join(", ")}`)
console.log(`  host:     ${samples.map((sample) => Math.round(sample.host)).join(", ")}`)
for (const id of ids)
  console.log(`  ${id}: ${samples.map((sample) => Math.round(sample.plugins.get(id) ?? 0)).join(", ")}`)
if (failures.length > 0) {
  console.error(`\nStartup ratchet failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
  console.error(
    "Make the activation cheaper, or raise the budget in startup-budget.json and state the reason in the PR.",
  )
  process.exit(1)
}
console.log("\nStartup ratchet passed.")

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function ms(value: number | undefined) {
  return value === undefined ? "-" : `${Math.round(value)} ms`
}
