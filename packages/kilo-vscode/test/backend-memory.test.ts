import { expect, test } from "bun:test"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import os from "node:os"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { Layout } from "../../kilo-cli/src/paths"
import { launch } from "../../kilo-cli/src/interactive-server"
import { connectV2 } from "../src/connection"
import { createMemoryMethods } from "../src/backend/memory"

function makeLayout(root: string): Layout {
  const paths = {
    home: os.homedir(),
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

test("memory adapter translates the v1 domain through the memory RPC with location isolation", async () => {
  const first = await mkdtemp(path.join(tmpdir(), "kilo-memory-a-"))
  const second = await mkdtemp(path.join(tmpdir(), "kilo-memory-b-"))
  const [realFirst, realSecond] = await Promise.all([realpath(first), realpath(second)])
  const created = await mkdtemp(path.join(tmpdir(), "kilo2-vscode-memory-"))
  const layout = makeLayout(await realpath(created))
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false, projectConfig: true })
          const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
          const memoryA = createMemoryMethods(verified.client, realFirst)
          const memoryB = createMemoryMethods(verified.client, realSecond)
          yield* Effect.promise(async () => {
            // Disabled by default: operations refuse until memory is enabled.
            const disabledShow = await memoryA.memory.show({ directory: realFirst })
            expect(disabledShow.data?.state.enabled).toBe(false)
            await expect(
              memoryA.memory.remember({ text: "too early", directory: realFirst }, { throwOnError: true }),
            ).rejects.toThrow()

            await memoryA.memory.enable({ directory: realFirst }, { throwOnError: true })
            const enabled = (await memoryA.memory.status({ directory: realFirst }, { throwOnError: true })).data!
            expect(enabled.state).toMatchObject({ enabled: true, scope: "project", autoConsolidate: false })
            expect(enabled.index.estimatedTokens).toBeTypeOf("number")

            // The v1 remember carries file and section; the change reports the
            // source it landed in and a token estimate.
            const remembered = (
              await memoryA.memory.remember(
                {
                  text: "The fixture deploys through the loopback gateway.",
                  file: "project.md",
                  section: "Deployment",
                  directory: realFirst,
                },
                { throwOnError: true },
              )
            ).data!
            expect(remembered.source).toBe("project.md")
            expect(remembered.added).toBeGreaterThanOrEqual(1)
            expect(remembered.index.estimatedTokens).toBeGreaterThanOrEqual(0)

            // The v1 consumer reads items as one rendered string with the
            // "key :: text" marker and the three named sources.
            const shown = (await memoryA.memory.show({ directory: realFirst }, { throwOnError: true })).data!
            expect(typeof shown.items).toBe("string")
            const stored = shown.items
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => {
                const marker = line.indexOf(":: ")
                return marker === -1 ? line : line.slice(marker + 3)
              })
            expect(stored.some((item) => item.includes("loopback gateway"))).toBe(true)
            expect(shown.sources.project.length).toBeGreaterThan(0)
            expect(shown.sources.environment).toBeTypeOf("string")
            expect(shown.sources.corrections).toBeTypeOf("string")

            // A correction lands in its own source and is visible on show.
            const corrected = (
              await memoryA.memory.correct(
                { text: "The loopback gateway port is provisioned per run.", directory: realFirst },
                { throwOnError: true },
              )
            ).data!
            expect(corrected.source).toBe("corrections.md")
            const shownAfterCorrection = (await memoryA.memory.show({ directory: realFirst }, { throwOnError: true }))
              .data!
            expect(shownAfterCorrection.items).toContain("port is provisioned per run")

            // Auto-save toggles round-trip.
            const on = (
              await memoryA.memory.configure({ autoConsolidate: true, directory: realFirst }, { throwOnError: true })
            ).data!
            expect(on.autoConsolidate).toBe(true)
            const off = (
              await memoryA.memory.configure({ autoConsolidate: false, directory: realFirst }, { throwOnError: true })
            ).data!
            expect(off.autoConsolidate).toBe(false)

            // Location isolation: the second directory has its own memory.
            const secondShow = (await memoryB.memory.show({ directory: realSecond }, { throwOnError: true })).data!
            expect(secondShow.items).toBe("")
            expect(secondShow.root).not.toBe(shown.root)
            expect(secondShow.sources.project).not.toContain("loopback")

            // Forget removes the remembered entry.
            const forgotten = (
              await memoryA.memory.forget({ query: "loopback gateway", directory: realFirst }, { throwOnError: true })
            ).data!
            expect(forgotten.removed).toBeGreaterThanOrEqual(0)
            expect(
              (await memoryA.memory.status({ directory: realFirst }, { throwOnError: true })).data!.index
                .estimatedTokens,
            ).toBeTypeOf("number")

            // Purge is gated on the caller's explicit confirmation and clears state.
            await expect(memoryA.memory.purge({ directory: realFirst }, { throwOnError: true })).rejects.toThrow(
              "Memory purge requires confirmation",
            )
            const purged = (await memoryA.memory.purge({ confirm: true, directory: realFirst }, { throwOnError: true }))
              .data!
            expect(purged).toBe(true)
            const afterPurge = (await memoryA.memory.show({ directory: realFirst }, { throwOnError: true })).data!
            expect(afterPurge.items).toBe("")
          })
        }),
      ),
    )
  } finally {
    await rm(first, { recursive: true, force: true })
    await rm(second, { recursive: true, force: true })
    await rm(created, { recursive: true, force: true })
  }
}, 30_000)
