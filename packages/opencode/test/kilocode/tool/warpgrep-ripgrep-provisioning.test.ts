import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "node:path"
import * as Provision from "../../../src/kilocode/tool/warpgrep"
import { tmpdir } from "../../fixture/fixture"
import { it } from "../../lib/effect"
import { plugin } from "../../../script/kilocode/morph-ripgrep"

describe("codebase_search ripgrep provisioning", () => {
  it.effect("skips managed provisioning in source mode", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const binary = Layer.mock(RipgrepBinary.Service, {
        filepath: Effect.sync(() => calls.push("filepath")).pipe(Effect.andThen(Effect.succeed("rg"))),
      })

      const provision = yield* Provision.provision.pipe(Effect.provide(binary))
      const result = yield* provision("find the entry point")

      expect(result).toBeUndefined()
      expect(calls).toEqual([])
    }),
  )

  it.effect("returns a normal failure when packaged provisioning dies", () =>
    Effect.gen(function* () {
      const failure = new Error("ripgrep provisioning failed")
      const binary = Layer.mock(RipgrepBinary.Service, {
        filepath: Effect.die(failure),
      })

      const provision = yield* Provision.prepare.pipe(Effect.provide(binary))
      const result = yield* provision("find the entry point")

      expect(result).not.toBeUndefined()
      if (!result) return
      expect(result).toEqual({
        title: "Codebase Search: find the entry point",
        output: `Codebase search unavailable: ${failure.message}`,
        metadata: { count: 0 },
      })
    }),
  )
})

test("bundles the Morph ripgrep import through the Kilo plugin", async () => {
  await using tmp = await tmpdir()
  const entry = path.join(tmp.path, "entry.ts")
  const out = path.join(tmp.path, "out")
  const root = path.resolve(import.meta.dir, "../../../")

  await Bun.write(entry, 'import { rgPath } from "@vscode/ripgrep"\nconsole.log(rgPath)\n')
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: out,
    plugins: [plugin(root)],
    target: "bun",
  })

  expect(result.success).toBe(true)
  if (!result.success) return
  const output = await result.outputs[0].text()
  expect(output).not.toContain("@vscode/ripgrep")
  expect(output).not.toContain("ripgrep-darwin-arm64")
  expect(output).not.toContain("Ensure optionalDependencies are installed")
})
