import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Fiber } from "effect"
import { MCP } from "../../src/mcp/index"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(MCP.node))
const fixture = path.join(import.meta.dir, "fixture/mcp-pid-stdio.ts")
const dir = path.join(os.tmpdir(), `kilo-mcp-interrupt-${process.pid}`)
const ready = path.join(dir, "ready.pid")
const hanging = path.join(dir, "hanging.pid")

const pid = (file: string) =>
  pollWithTimeout(
    Effect.promise(async () => {
      const handle = Bun.file(file)
      return (await handle.exists()) ? Number(await handle.text()) : undefined
    }),
    `${path.basename(file)} was not written`,
  )

const alive = (id: number) => {
  try {
    process.kill(id, 0)
    return true
  } catch {
    return false
  }
}

it.instance(
  "an interrupted MCP startup closes servers that already connected and retries",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service

      // A client that disconnects while MCP servers are still starting interrupts the lookup.
      const fiber = yield* mcp.status().pipe(Effect.forkScoped)
      const first = yield* pid(ready)
      yield* pid(hanging)
      // The fixture writes this once the MCP state holds `ready` as a connected client.
      yield* pollWithTimeout(
        Effect.promise(() => Bun.file(`${ready}.stored`).exists()).pipe(
          Effect.map((done) => (done ? true : undefined)),
        ),
        "ready client was never stored",
      )
      yield* Fiber.interrupt(fiber)

      const status = yield* mcp.status()
      expect(status["ready"]?.status).toBe("connected")
      expect(status["hanging"]?.status).toBe("failed")

      // The server that connected before the interruption is not left running.
      yield* pollWithTimeout(
        Effect.sync(() => (alive(first) ? undefined : true)),
        "server from the interrupted startup is still running",
      )
    }),
  {
    init: () =>
      Effect.promise(async () => {
        await fs.rm(dir, { recursive: true, force: true })
        await fs.mkdir(dir, { recursive: true })
      }),
    config: {
      mcp: {
        ready: {
          type: "local",
          command: [process.execPath, fixture],
          environment: { MCP_PID_FILE: ready },
        },
        hanging: {
          type: "local",
          command: [process.execPath, fixture, "--hang"],
          environment: { MCP_PID_FILE: hanging },
          // Keeps the lookup in progress until the test interrupts it; also bounds the retry.
          timeout: 5000,
        },
      },
    },
  },
  30_000,
)
