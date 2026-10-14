import { afterAll, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef } from "@/effect/instance-ref"
import { GoalState } from "@/kilocode/session/goal/state"
import { Wakeup } from "@/kilocode/wakeup"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"

afterAll(() => AppRuntime.dispose())
test("goal clear with a truncated wakeup finishes and removes it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wakeup-corrupt-goal-"))
  try {
    const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory })))
    const session = await AppRuntime.runPromise(
      Session.Service.use((svc) => svc.create({ title: "corrupt cleanup" })).pipe(
        Effect.provideService(InstanceRef, ctx),
      ),
    )
    const task = await AppRuntime.runPromise(
      Wakeup.Service.use((svc) =>
        svc.schedule({ sessionID: session.id, directory, prompt: "clear goal", delay: "10m" }),
      ).pipe(Effect.provideService(InstanceRef, ctx)),
    )
    await AppRuntime.runPromise(
      Session.Service.use((svc) =>
        svc.setMetadata({
          sessionID: session.id,
          metadata: {
            "kilo.goal": {
              text: "wait for check",
              status: "waiting",
              active: false,
              wait: { kind: "wakeup", id: task.id, label: "wait", dueAt: task.dueAt },
            },
          },
        }),
      ).pipe(Effect.provideService(InstanceRef, ctx)),
    )
    GoalState.markWaiting(session.id)
    const file = path.join(Global.Path.data, "storage", "wakeup", session.id, `${task.id}.json`)
    await Bun.write(file, '{"id":"' + task.id.slice(0, 6))
    const start = Date.now()
    await AppRuntime.runPromise(
      SessionPrompt.Service.use((svc) =>
        svc.command({
          sessionID: session.id,
          command: "goal",
          arguments: "clear",
          agent: "code",
          model: "test/test-model",
        }),
      ).pipe(Effect.provideService(InstanceRef, ctx), Effect.timeout("3 seconds")),
    )
    expect(Date.now() - start).toBeLessThan(3000)
    expect(await Bun.file(file).exists()).toBe(false)
    const stored = await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(session.id)))
    expect(stored.metadata?.["kilo.goal"]).toBeUndefined()
  } finally {
    await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.disposeDirectory(directory)))
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 15000)
