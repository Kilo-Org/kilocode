import { Effect } from "effect"
import { BackgroundJob } from "@/background/job"
import { BackgroundProcess } from "@/kilocode/background-process"
import { InteractiveTerminal } from "@/kilocode/interactive-terminal"
import { Service as Notebook } from "@/kilocode/notebook/service"
import type { Target } from "@/kilocode/sandbox/policy"
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import type { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"

export const family = Effect.fn("SandboxActivation.family")(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  const visit = (id: SessionID): Effect.Effect<Target[]> =>
    Effect.gen(function* () {
      const children = yield* sessions.children(id)
      const nested = yield* Effect.forEach(children, (child) => visit(child.id))
      return [...children.map((child) => ({ id: child.id, directory: child.directory })), ...nested.flat()]
    })
  return [{ id: sessionID, directory: yield* InstanceState.directory }, ...(yield* visit(sessionID))]
})

export const idle = Effect.fn("SandboxActivation.idle")(function* (
  sessionID: SessionID,
  family: readonly Target[],
) {
  const status = yield* SessionStatus.Service
  const background = yield* BackgroundJob.Service
  const notebook = yield* Notebook
  const current = yield* InstanceState.directory
  const ids = new Set<string>(family.map((target) => target.id))
  const root = family.find((target) => target.id === sessionID) ?? family[0]
  const groups = new Map<string, Target[]>()
  for (const target of family) {
    const group = groups.get(target.directory) ?? []
    group.push(target)
    groups.set(target.directory, group)
  }
  const scans = yield* Effect.forEach([...groups.entries()], ([directory, targets]) => {
    const scan = Effect.all(
      [
        status.list(),
        background.list(),
        Effect.promise(() => BackgroundProcess.list()),
        Effect.promise(() => InteractiveTerminal.list()),
        notebook.list(),
      ] as const,
    ).pipe(Effect.map((resources) => ({ directory, targets, resources })))
    if (directory === current) return scan
    return Effect.flatMap(InstanceStore.Service, (store) => store.provide({ directory }, scan))
  })

  for (const scan of scans) {
    const [states, jobs, processes, terminals, requests] = scan.resources
    if (scan.targets.some((target) => states.has(target.id))) return false
    if (
      jobs.some((job) => {
        const child = job.metadata?.sessionId
        const parent = job.metadata?.parentSessionId
        return (
          job.status === "running" &&
          (ids.has(job.id) ||
            (typeof child === "string" && ids.has(child)) ||
            (typeof parent === "string" && ids.has(parent)))
        )
      })
    )
      return false
    if (
      processes.some((process) => {
        if (!ids.has(process.sessionID) || ["exited", "failed", "stopped"].includes(process.status)) return false
        return (
          process.sessionID !== sessionID ||
          process.lifetime !== "session" ||
          scan.directory !== root?.directory
        )
      })
    )
      return false
    if (
      terminals.some(
        (terminal) =>
          ids.has(terminal.sessionID) &&
          (terminal.sessionID !== sessionID || scan.directory !== root?.directory),
      )
    )
      return false
    if (
      requests.some(
        (request) =>
          ids.has(request.sessionID) &&
          (request.sessionID !== sessionID || scan.directory !== root?.directory),
      )
    )
      return false
  }
  return true
})
