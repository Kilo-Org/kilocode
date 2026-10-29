import { expect } from "bun:test"
import path from "path"
import { rm } from "fs/promises"
import os from "os"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { EventV2Bridge } from "@/event-v2-bridge"
import { KiloHooks } from "@/kilocode/hooks/hooks"
import { KiloHookSession } from "@/kilocode/hooks/session"
import type { InstanceContext } from "@/project/instance-context"
import type { Instruction } from "@/session/instruction"
import { SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

// The InstructionsLoaded runs that root sessions owe their next model step are remembered for a
// bounded number of sessions, as the SessionStart runs they follow are.

const file = path.join(os.tmpdir(), "AGENTS.md")
const marker = path.join(os.tmpdir(), `kilo-hooks-session-${process.pid}.jsonl`)

const hooks: KiloHooks.Hooks = {
  InstructionsLoaded: [
    {
      hooks: [
        {
          type: "command",
          command: process.execPath,
          args: [
            "-e",
            `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(marker)}, fs.readFileSync(0, 'utf8').trim() + '\\n')`,
          ],
        },
      ],
    },
  ],
}

const it = testEffect(
  Layer.mergeAll(
    TestConfig.layer({ get: () => Effect.succeed({ hooks }) }),
    AppNodeBuilder.build(Database.node),
    AppNodeBuilder.build(EventV2Bridge.node),
  ),
)

const runs = async () =>
  (await Bun.file(marker).exists())
    ? (await Bun.file(marker).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kilo_session_id?: string })
    : []

const instance = {
  directory: process.cwd(),
  worktree: process.cwd(),
  project: {
    id: ProjectV2.ID.make("test-project"),
    worktree: process.cwd(),
    vcs: "git",
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
} satisfies InstanceContext

const info = (id: SessionID, parentID?: SessionID) =>
  ({ id, parentID, permission: [], directory: process.cwd() }) as unknown as Session.Info

it.live(
  "forgets the InstructionsLoaded run of the oldest session once too many started",
  () =>
    Effect.gen(function* () {
      const config = yield* Config.Service
      const database = yield* Database.Service
      const events = yield* EventV2Bridge.Service
      yield* Effect.promise(() => rm(marker, { force: true }))
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await KiloHookSession.end("other")
          await rm(marker, { force: true })
        }),
      )
      const ids = Array.from({ length: 10_001 }, (_, i) => SessionID.make(`ses_loads_${i}`))
      for (const id of ids) {
        yield* KiloHookSession.ensure({
          sessionID: id,
          sessions: {} as never,
          config,
          database,
          events,
          session: info(id),
          hooks,
          fresh: true,
        })
      }
      // The next model step of a session with a parent skips SessionStart and only collects the run it owes.
      const step = (id: SessionID) =>
        KiloHookSession.inject({
          msgs: [],
          lastUser: { id: "msg_user" } as never,
          session: info(id, SessionID.make("ses_loads_parent")),
          sessionID: id,
          step: 1,
          instruction: { systemPaths: () => Effect.succeed(new Set([file])) } as unknown as Instruction.Interface,
          sessions: {} as never,
          config,
          database,
          events,
        })
      const first = ids.at(0)
      const last = ids.at(-1)
      if (!first || !last) throw new Error("no sessions")
      yield* step(last)
      yield* Effect.promise(async () => {
        for (let i = 0; i < 100 && (await runs()).length < 1; i++) await Bun.sleep(50)
      })
      expect((yield* Effect.promise(runs)).map((item) => item.kilo_session_id)).toEqual([last])
      yield* step(first)
      yield* Effect.promise(() => Bun.sleep(500))
      expect((yield* Effect.promise(runs)).map((item) => item.kilo_session_id)).toEqual([last])
    }).pipe(Effect.provideService(InstanceRef, instance)),
  120_000,
)
