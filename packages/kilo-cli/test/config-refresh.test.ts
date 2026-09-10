import { expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import { Effect } from "effect"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { SettingsRpc } from "../src/settings-rpc"
import { fixture } from "./fixture"

test("explicit settings refresh preserves sessions and PTYs and retains config after malformed input", async () => {
  await using input = await fixture()
  const file = path.join(input.cwd, "kilo.jsonc")
  await Bun.write(file, JSON.stringify({ experimental: { subagent_depth: 2 } }))
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(
          { ...input.layout, channel: "interactive" },
          { models: false, recover: false, projectConfig: true },
        )
        yield* Effect.promise(async () => {
          const client = OpenCode.make({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          const location = { directory: input.cwd }
          const settings = client.rpc(SettingsRpc.Definition)
          const depth = async () =>
            (await client.config.get({ location }))
              .filter((entry) => entry.type === "document")
              .findLast((entry) => entry.info.experimental?.subagent_depth !== undefined)
              ?.info.experimental?.subagent_depth
          expect(await depth()).toBe(2)
          const session = await client.session.create({ location, title: "Preserve across refresh" })
          const terminal = await client.pty.create({ location, command: "/bin/sh", args: [], cwd: input.cwd })
          try {
            expect(terminal.data.status).toBe("running")
            await Bun.write(file, JSON.stringify({ experimental: { subagent_depth: 5 } }))
            expect(await settings.refresh({}, { location })).toBe(true)
            expect(await depth()).toBe(5)
            expect((await client.session.get({ sessionID: session.id })).id).toBe(session.id)
            const preserved = await client.pty.get({ location, ptyID: terminal.data.id })
            expect(preserved.data.pid).toBe(terminal.data.pid)
            expect(preserved.data.status).toBe("running")
            await Bun.write(file, '{ "experimental": invalid }')
            await expect(settings.refresh({}, { location })).rejects.toThrow()
            expect(await depth()).toBe(5)
            expect((await client.pty.get({ location, ptyID: terminal.data.id })).data.status).toBe("running")
          } finally {
            await client.pty.remove({ location, ptyID: terminal.data.id })
          }
        })
      }),
    ),
  )
}, 30_000)
