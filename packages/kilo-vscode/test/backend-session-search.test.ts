import { expect, test } from "bun:test"
import { Effect } from "effect"
import { execFileSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fixture } from "../../kilo-cli/test/fixture"
import { launch } from "../../kilo-cli/src/interactive-server"
import { connectV2 } from "../src/connection"
import { createKiloClient } from "../src/backend"
import { handleSessionSearch } from "../src/kilo-provider/session-search"

test("original past-chat picker includes sibling worktrees and excludes unrelated projects", async () => {
  await using input = await fixture()
  execFileSync("git", ["init", "--quiet"], { cwd: input.cwd })
  execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-qm", "fixture"],
    { cwd: input.cwd },
  )
  const sibling = path.join(input.directory, "sibling-worktree")
  execFileSync("git", ["worktree", "add", "--quiet", "--detach", sibling], { cwd: input.cwd })
  const unrelated = path.join(input.directory, "unrelated")
  await mkdir(unrelated)
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch({ ...input.layout, channel: "interactive" }, { models: false, recover: false })
        const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
        yield* Effect.promise(async () => {
          const native = verified.client
          const main = await native.session.create({ location: { directory: input.cwd }, title: "Main conversation" })
          const linked = await native.session.create({
            location: { directory: sibling },
            title: "Sibling conversation",
          })
          const foreign = await native.session.create({
            location: { directory: unrelated },
            title: "Unrelated conversation",
          })
          const client = createKiloClient({ client: native, directory: input.cwd })
          const family = await client.experimental.session.list(
            { directory: sibling, worktrees: true, roots: true },
            { throwOnError: true },
          )
          expect(family.data.map((item) => item.id).sort()).toEqual([main.id, linked.id].sort())
          expect(family.data.find((item) => item.id === linked.id)?.worktreeName).toBe("sibling-worktree")
          expect(family.data.find((item) => item.id === main.id)?.worktreeName).toBe("project")
          expect(
            (await client.experimental.session.list({ directory: input.cwd }, { throwOnError: true })).data.map(
              (item) => item.id,
            ),
          ).toEqual([main.id])
          expect(
            (await client.experimental.session.list({ roots: true, archived: true, limit: 1 }, { throwOnError: true }))
              .data,
          ).toHaveLength(1)
          expect(
            (
              await client.experimental.session.list({ worktrees: true, search: "Sibling" }, { throwOnError: true })
            ).data.map((item) => item.id),
          ).toEqual([linked.id])
          const messages: unknown[] = []
          await handleSessionSearch({
            client,
            message: { requestId: "picker" },
            dir: () => input.cwd,
            exclude: main.id,
            post: (message) => messages.push(message),
          })
          expect(messages).toEqual([
            {
              type: "sessionSearchResult",
              requestId: "picker",
              sessions: [
                { id: linked.id, title: linked.title, updated: linked.time.updated, worktreeName: "sibling-worktree" },
              ],
            },
          ])
          expect(family.data.some((item) => item.id === foreign.id)).toBe(false)
          await expect(client.experimental.session.list({ limit: 0 }, { throwOnError: true })).rejects.toThrow(
            "positive integer",
          )
        })
      }),
    ),
  )
}, 30_000)
