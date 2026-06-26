import fs from "node:fs/promises"
import { Effect } from "effect"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { SandboxStore } from "@/kilocode/sandbox/store"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"

const input = JSON.parse(process.argv[2] ?? "{}") as {
  sessionID: string
  directory: string
  ready: string
  start: string
  count: number
}

const context = {
  directory: input.directory,
  worktree: input.directory,
  project: {
    id: ProjectID.make("sandbox-process-toggle"),
    worktree: input.directory,
    vcs: "git" as const,
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
}

const current = SandboxStore.current
SandboxStore.current = async (sessionID) => {
  const snapshot = await current(sessionID)
  await Bun.sleep(100)
  return snapshot
}

await fs.writeFile(input.ready, String(process.pid))
while (!(await Bun.file(input.start).exists())) await Bun.sleep(5)

await Effect.gen(function* () {
  for (const _ of Array.from({ length: input.count })) {
    yield* SandboxPolicy.toggle(SessionID.make(input.sessionID))
  }
}).pipe(
  Effect.provide(Bus.layer),
  Effect.provide(Config.defaultLayer),
  Effect.provideService(InstanceRef, context),
  Effect.runPromise,
)
