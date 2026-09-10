import { expect, test } from "bun:test"
import { Effect } from "effect"
import { fixture } from "../../kilo-cli/test/fixture"
import { launch } from "../../kilo-cli/src/interactive-server"
import { connectV2 } from "../src/connection"
import { createKiloClient } from "../src/backend"

test("original stopSession removes only the selected session's real shell processes", async () => {
  await using input = await fixture()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch({ ...input.layout, channel: "interactive" }, { models: false, recover: false })
        const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
        yield* Effect.promise(async () => {
          const client = verified.client
          const location = { directory: input.cwd }
          const first = await client.session.create({ location, title: "Stop this session" })
          const second = await client.session.create({ location, title: "Keep this session" })
          const selected = await client.shell.create({
            location,
            command: "sleep 60",
            timeout: 0,
            metadata: { sessionID: first.id },
          })
          const other = await client.shell.create({
            location,
            command: "sleep 60",
            timeout: 0,
            metadata: { sessionID: second.id },
          })
          try {
            expect(selected.data.status).toBe("running")
            expect(other.data.status).toBe("running")
            const adapter = createKiloClient({ client, directory: input.cwd })
            const stopped = await adapter.backgroundProcess.stopSession({ sessionID: first.id }, { throwOnError: true })
            expect(stopped.data).toBe(true)
            const pid = selected.data.pid
            if (pid === undefined) throw new Error("Selected shell did not expose its process ID")
            const deadline = Date.now() + 5_000
            while (Date.now() < deadline) {
              try {
                process.kill(pid, 0)
              } catch {
                break
              }
              await Bun.sleep(20)
            }
            expect(() => process.kill(pid, 0)).toThrow()
            const remaining = await client.shell.list({ location })
            expect(remaining.data.map((shell) => shell.id)).toEqual([other.data.id])
            expect((await client.shell.get({ id: other.data.id, location })).data.pid).toBe(other.data.pid)
            expect(
              (await adapter.backgroundProcess.stopSession({ sessionID: first.id }, { throwOnError: true })).data,
            ).toBe(true)
            const controller = new AbortController()
            controller.abort()
            const refused = await adapter.backgroundProcess.stopSession(
              { sessionID: second.id },
              { signal: controller.signal },
            )
            expect(refused.error).toBeDefined()
            expect((await client.shell.get({ id: other.data.id, location })).data.status).toBe("running")
          } finally {
            for (const shell of (await client.shell.list({ location })).data) {
              await client.shell.remove({ id: shell.id, location })
            }
          }
        })
      }),
    ),
  )
}, 30_000)
