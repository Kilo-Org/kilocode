import { Cause, Deferred, Effect, Exit, Fiber, Result, Scope } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { KiloHeadless } from "@/kilocode/permission/headless"
import { SessionDrain } from "@/kilocode/session/drain"
import { GoalState } from "@/kilocode/session/goal/state"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import type { CommandInput } from "@/session/prompt"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { Provider } from "@/provider/provider"
import { AutonomousBudget } from "./budget"
import { AutonomousChecker } from "./checker"
import { AutonomousConfig } from "./config"
import { AutonomousFinal } from "./final"
import { AutonomousIssue } from "./issue"
import { AutonomousMemory } from "./memory"
import { AutonomousLog } from "./log"
import { AutonomousModels } from "./models"
import { AutonomousPlanner } from "./planner"
import { AutonomousProgress } from "./progress"
import { AutonomousRepair } from "./repair"
import { AutonomousReviewer } from "./reviewer"
import { AutonomousRouter } from "./router"
import { AutonomousRunner } from "./runner"
import { AutonomousScheduler } from "./scheduler"
import { AutonomousState } from "./state"
import { AutonomousStats } from "./stats"
import { AutonomousStatus } from "./status"
import { AutonomousStore } from "./store"
import { AutonomousVerifier } from "./verifier"
import { AutonomousWorker } from "./worker"

/**
 * The goal loop: plan → run tasks (worker → checks → review, with repair and
 * escalation) → goal check → final review. One task at a time, state persisted
 * after every transition, status mirrored into `session.metadata["kilo.goal"]`.
 */
export namespace AutonomousEngine {
  export const MAX_REVISIONS = 3
  type Run = { fiber: Fiber.Fiber<void, never>; stopped: Deferred.Deferred<void> }

  const goalStatus = (status: AutonomousState.GoalStatus) =>
    status === "completed" ? "complete" : status === "paused" ? "paused" : status === "blocked" || status === "failed" ? "blocked" : "active"

  export const make = Effect.fn("AutonomousEngine.make")(function* () {
    const sessions = yield* Session.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const storage = yield* Storage.Service
    const agents = yield* Agent.Service
    const drain = yield* SessionDrain.Service
    const ops = yield* AutonomousRunner.Ops
    const scopes = yield* InstanceState.make(() => Scope.Scope)
    const runs = new Map<SessionID, Run>()

    // Engine work runs in forked fibers and from callers outside this layer, so
    // every service it needs is captured here and provided explicitly.
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(Session.Service, sessions),
        Effect.provideService(Config.Service, config),
        Effect.provideService(Provider.Service, provider),
        Effect.provideService(EventV2Bridge.Service, events),
        Effect.provideService(Storage.Service, storage),
        Effect.provideService(Agent.Service, agents),
        Effect.provideService(SessionDrain.Service, drain),
        Effect.provideService(AutonomousRunner.Ops, ops),
      )
    const settling = new Set<SessionID>()

    const mirror = Effect.fn("AutonomousEngine.mirror")(function* (state: AutonomousState.Info) {
      const session = yield* sessions.get(state.sessionID).pipe(Effect.option)
      if (session._tag === "None") return
      const status = goalStatus(state.status)
      yield* sessions.setMetadata({
        sessionID: state.sessionID,
        metadata: {
          ...session.value.metadata,
          "kilo.goal": { text: state.objective, status, active: status === "active", ...(state.reason ? { reason: state.reason } : {}) },
        },
      })
    })

    const persist = (state: AutonomousState.Info) => AutonomousStore.save(state).pipe(Effect.andThen(mirror(state)), Effect.orDie)

    /** Append a synthetic assistant message to the goal's session. Never fails the caller. */
    const post = (sessionID: SessionID, text: string, input?: { messageID?: MessageID; agent?: string; model?: string }) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
        const ctx = yield* InstanceState.context
        const model = input?.model ? Provider.parseModel(input.model) : session.model ? { providerID: session.model.providerID, modelID: session.model.id } : yield* provider.defaultModel()
        const now = Date.now()
        const info: SessionV1.Assistant = {
          id: MessageID.ascending(),
          sessionID,
          parentID: input?.messageID ?? MessageID.ascending(),
          role: "assistant",
          mode: input?.agent ?? session.agent ?? "code",
          agent: input?.agent ?? session.agent ?? "code",
          providerID: model.providerID,
          modelID: model.modelID,
          path: { cwd: ctx.directory, root: ctx.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, completed: now },
          finish: "stop",
        }
        const part: SessionV1.TextPart = { id: PartID.ascending(), messageID: info.id, sessionID, type: "text", text }
        yield* sessions.updateMessage(info)
        yield* sessions.updatePart(part)
        return { info, parts: [part] } satisfies SessionV1.WithParts
      })

    /** Live progress line in the goal's session so the user can follow the run. */
    const progress = (state: AutonomousState.Info, text: string) =>
      post(state.sessionID, `**Goal** · ${text}`).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => Effect.logWarning("autonomous progress message failed", { cause })),
      )

    const settle = (state: AutonomousState.Info, status: AutonomousState.GoalStatus, reason: string) =>
      Effect.gen(function* () {
        // Session metadata writes are re-projected through GoalState.project, which
        // forces "active" while a run token is live. Release it before settling.
        if (!AutonomousState.active(status)) {
          settling.add(state.sessionID)
          GoalState.pause(state.sessionID, true)
        }
        state.status = status
        state.reason = reason
        AutonomousLog.record(state, `goal.${status}`, { detail: reason })
        yield* persist(state).pipe(Effect.ensuring(Effect.sync(() => settling.delete(state.sessionID))))
        yield* progress(state, `${AutonomousProgress.outcome(status)}: ${reason}`)
      })

    const stop = Effect.fn("AutonomousEngine.stop")(function* (id: SessionID) {
      const run = runs.get(id)
      if (!run) return false
      runs.delete(id)
      yield* Deferred.done(run.stopped, Exit.void)
      yield* Fiber.interrupt(run.fiber)
      return true
    })

    /** One full engine pass. Returns when the goal settles or is interrupted. */
    const drive = Effect.fn("AutonomousEngine.drive")(function* (id: SessionID, state: AutonomousState.Info) {
      const raw = yield* config.get()
      const cfg = AutonomousConfig.resolve(raw)
      const models = yield* AutonomousModels.resolve({
        autonomous: cfg,
        config: { model: raw.model ?? undefined, small_model: raw.small_model ?? undefined, subagent_model: raw.subagent_model ?? undefined },
      }).pipe(Effect.provideService(Provider.Service, provider))
      const dir = (yield* InstanceState.context).directory
      const checks = cfg.checks ? AutonomousVerifier.fromConfig(cfg.checks) : yield* AutonomousVerifier.detect(dir)
      const projectID = String((yield* sessions.get(id).pipe(Effect.orDie)).projectID)
      const memory = yield* AutonomousMemory.load(projectID)
      let stats = yield* AutonomousStats.load(projectID)
      const learn = (task: AutonomousState.Task) =>
        Effect.gen(function* () {
          stats = yield* AutonomousStats.learn(projectID, task)
        })
      // The first plan of this goal counts it toward the memory; replans only refresh the summary.
      let counted = state.revision > 0
      const remember = (summary: string) =>
        Effect.gen(function* () {
          if (!summary.trim().length) return
          yield* AutonomousMemory.save({ projectID, summary, count: !counted })
          counted = true
        })
      const charge = (modelClass: AutonomousState.ModelClass, out: { cost: number; tokens: { input: number; output: number } }, taskID?: string) =>
        AutonomousBudget.charge(state, { modelClass, taskID, cost: out.cost, tokens: out.tokens })
      /** Charge the usage of a failed runner call before the error propagates, so budgets hold under repeated failure. */
      const billed = <A, E, R>(modelClass: AutonomousState.ModelClass, effect: Effect.Effect<A, E, R>, taskID?: string) =>
        effect.pipe(
          Effect.tapError((err) =>
            Effect.gen(function* () {
              charge(modelClass, AutonomousRunner.spent(err), taskID)
              yield* persist(state)
            }),
          ),
        )
      const log = (event: string, opts?: { taskID?: string; detail?: string }) => AutonomousLog.record(state, event, opts)
      const paused = (reason: string) => settle(state, "paused", reason)
      const blocked = (reason: string) => settle(state, "blocked", reason)

      const replan = (input: { newWork?: string[]; findings?: string[] }) =>
        Effect.gen(function* () {
          if (state.revision >= MAX_REVISIONS) return false
          if (!AutonomousBudget.allow(state, cfg)) return false
          state.revision++
          const planned = yield* billed(
            "cloud-reasoner",
            AutonomousPlanner.plan({
              parent: id,
              state,
              model: models["cloud-reasoner"],
              steps: cfg.steps.planner,
              maxCost: AutonomousBudget.left(state, cfg, "cloud-reasoner"),
              maxAttempts: cfg.worker_max_attempts,
              replan: input,
              memory: memory?.summary,
              history: AutonomousStats.summary(stats),
            }),
          )
          charge("cloud-reasoner", planned)
          yield* remember(planned.plan.repo_summary)
          state.tasks = AutonomousScheduler.merge(state, planned.tasks)
          for (const c of planned.plan.acceptance_criteria) {
            if (!state.criteria.some((x) => x.id === c.id)) state.criteria.push({ id: c.id, description: c.description, status: "open" })
          }
          state.status = "running"
          log("replanned", { detail: `revision ${state.revision}, ${state.tasks.length} tasks` })
          yield* persist(state)
          yield* progress(state, AutonomousProgress.plan(state, `Replanned (revision ${state.revision})`))
          return true
        })

      if (state.status === "planning") {
        if (!AutonomousBudget.allow(state, cfg)) return yield* paused(AutonomousBudget.reason(state, cfg)!)
        yield* progress(state, `Planning with ${AutonomousModels.format(models["cloud-reasoner"])}. The planner reads the repository first; this can take a few minutes.`)
        const planned = yield* billed(
          "cloud-reasoner",
          AutonomousPlanner.plan({
            parent: id,
            state,
            model: models["cloud-reasoner"],
            steps: cfg.steps.planner,
            maxCost: AutonomousBudget.left(state, cfg, "cloud-reasoner"),
            maxAttempts: cfg.worker_max_attempts,
            memory: memory?.summary,
            history: AutonomousStats.summary(stats),
          }),
        )
        charge("cloud-reasoner", planned)
        yield* remember(planned.plan.repo_summary)
        state.summary = planned.plan.goal_summary
        state.criteria = planned.plan.acceptance_criteria.map((c) => ({ id: c.id, description: c.description, status: "open" as const }))
        state.tasks = planned.tasks
        state.status = "running"
        log("planned", { detail: `${state.tasks.length} tasks, ${state.criteria.length} criteria` })
        yield* persist(state)
        yield* progress(state, AutonomousProgress.plan(state, "Plan ready"))
      }
      if (state.status !== "running" && state.status !== "reviewing") {
        state.status = "running"
        state.reason = undefined
        yield* persist(state)
      }

      const fail = (task: AutonomousState.Task, stage: AutonomousState.Stage, message: string, modelClass: AutonomousState.ModelClass, fingerprint?: string) =>
        Effect.gen(function* () {
          AutonomousRepair.record(task, { stage, message, modelClass, fingerprint })
          const decision = AutonomousRepair.decide(task, cfg)
          log(`task.${stage}.failed`, { taskID: task.id, detail: `${decision.action}: ${decision.reason}` })
          yield* progress(state, AutonomousProgress.failed(state, task, stage, message, decision))
          if (decision.action === "retry") task.status = "repairing"
          if (decision.action === "escalate") {
            task.status = "repairing"
            task.escalated = true
            state.escalations++
          }
          if (decision.action === "fail") {
            task.status = "failed"
            AutonomousScheduler.propagate(state)
            yield* learn(task)
          }
          yield* persist(state)
        })

      for (;;) {
        AutonomousScheduler.propagate(state)
        const task = AutonomousScheduler.next(state)
        if (!task) {
          const dead = state.tasks.filter((t) => t.status === "failed" || t.status === "blocked")
          if (dead.length) {
            return yield* blocked(
              `Tasks could not be completed: ${dead.map((t) => `${t.id} (${t.failures.at(-1)?.message.split("\n")[0] ?? t.status})`).join("; ")}. Fix the cause, then /goal resume retries the failed tasks, or /goal clear drops the goal.`,
            )
          }
          if (!AutonomousBudget.allow(state, cfg)) return yield* paused(AutonomousBudget.reason(state, cfg)!)
          state.status = "reviewing"
          yield* persist(state)
          yield* progress(state, "All tasks done. Checking the goal against its acceptance criteria.")
          const check = yield* billed("cloud-reasoner", AutonomousChecker.check({
              parent: id,
              dir,
              state,
              model: models["cloud-reasoner"],
              steps: cfg.steps.reviewer,
              maxCost: AutonomousBudget.left(state, cfg, "cloud-reasoner"),
            }),
          )
          charge("cloud-reasoner", check)
          log("goal.checked", { detail: check.complete ? "complete" : `unmet: ${state.criteria.filter((c) => c.status !== "satisfied").map((c) => c.id).join(",")}` })
          if (!check.complete) {
            const newWork = check.check.new_work.length ? [...check.check.new_work] : state.criteria.filter((c) => c.status !== "satisfied").map((c) => `${c.id}: ${c.description}${c.reason ? ` (${c.reason})` : ""}`)
            if (yield* replan({ newWork })) continue
            return yield* blocked(`Goal check found unmet criteria after ${state.revision} replans: ${newWork.join("; ")}`)
          }
          const report = yield* AutonomousVerifier.run({ dir, checks })
          const reasons = AutonomousFinal.gate(state, report)
          if (reasons.length) return yield* blocked(`Final gate failed: ${reasons.join("; ")}`)
          const cls = AutonomousFinal.modelClass(state, cfg.final_review_cloud_at_complexity)
          if (cls === "cloud-reasoner" && !AutonomousBudget.allow(state, cfg)) return yield* paused(AutonomousBudget.reason(state, cfg)!)
          yield* progress(state, `Checks pass. Final review with ${AutonomousModels.format(models[cls])}.`)
          const fin = yield* billed(cls, AutonomousFinal.review({ parent: id, dir, state, model: models[cls], steps: cfg.steps.reviewer, maxCost: AutonomousBudget.left(state, cfg, cls) }),
          )
          charge(cls, fin)
          if (fin.blocking.length) {
            const findings = fin.blocking.map((f) => `${f.file ? `${f.file}: ` : ""}${f.description}`)
            state.findings.push(...fin.blocking.map((f) => ({ id: f.id, type: f.type, file: f.file, description: f.description, blocking: true, resolved: false })))
            log("final.rejected", { detail: findings.join("; ") })
            if (yield* replan({ findings })) {
              for (const f of state.findings) f.resolved = true
              continue
            }
            return yield* blocked(`Final review rejected the change: ${findings.join("; ")}`)
          }
          state.final = { checks: true, review: true, modelClass: cls, summary: state.summary ?? state.objective, time: Date.now() }
          return yield* settle(state, "completed", `Verified by checks, goal check and final review (${cls}). ${AutonomousStatus.budget(state)}`)
        }

        const route = AutonomousRouter.route({ task, state, cfg, models, stats })
        if (!route.ok) return yield* paused(route.reason)
        task.route = { modelClass: route.modelClass, model: AutonomousModels.format(route.model), reason: route.reason }
        if (!task.first) task.first = route.modelClass
        task.status = "running"
        task.attempts++
        log("task.start", { taskID: task.id, detail: `${route.modelClass} (${route.reason}), attempt ${task.attempts}` })
        yield* persist(state)
        yield* progress(state, AutonomousProgress.start(state, task, route))

        const repair = task.failures.length ? AutonomousRepair.instructions(task) : undefined
        const work = yield* Effect.result(
          AutonomousWorker.run({
            parent: id,
            dir,
            state,
            task,
            model: route.model,
            repair,
            steps: cfg.steps.worker,
            maxCost: AutonomousBudget.left(state, cfg, route.modelClass, task.id),
          }),
        )
        if (Result.isFailure(work)) {
          charge(route.modelClass, AutonomousRunner.spent(work.failure), task.id)
          yield* fail(task, "worker", String(work.failure), route.modelClass)
          continue
        }
        const worked = work.success
        charge(route.modelClass, worked, task.id)
        if (worked.result.status === "blocked") {
          yield* fail(task, "blocked", `${worked.result.summary}\n${worked.result.unresolved.join("\n")}`, route.modelClass)
          continue
        }
        task.status = "verifying"
        yield* persist(state)
        yield* progress(state, AutonomousProgress.worked(task, worked.result))
        const report = yield* AutonomousVerifier.run({ dir, checks })
        if (!report.ok) {
          yield* fail(task, "check", AutonomousVerifier.summary(report), route.modelClass, AutonomousVerifier.fingerprint(report))
          continue
        }
        // Per-task review stays local; the goal check and final review are the cloud gates.
        const reviewClass: AutonomousState.ModelClass = "local-coder"
        const review = yield* Effect.result(
          AutonomousReviewer.review({ parent: id, dir, state, task, model: models[reviewClass], checks: report, steps: cfg.steps.reviewer }),
        )
        if (Result.isFailure(review)) {
          charge(reviewClass, AutonomousRunner.spent(review.failure), task.id)
          yield* fail(task, "review", String(review.failure), reviewClass)
          continue
        }
        const reviewed = review.success
        charge(reviewClass, reviewed, task.id)
        if (reviewed.blocking.length) {
          state.findings.push(...reviewed.blocking.map((f) => ({ id: `${task.id}:${f.id}`, taskID: task.id, type: f.type, file: f.file, description: f.description, blocking: true, resolved: false })))
          yield* fail(task, "review", AutonomousReviewer.describe(reviewed.blocking), reviewClass)
          continue
        }
        for (const f of state.findings) if (f.taskID === task.id) f.resolved = true
        task.status = "completed"
        log("task.completed", { taskID: task.id, detail: worked.result.summary })
        yield* progress(state, AutonomousProgress.done(state, task))
        yield* learn(task)
        yield* persist(state)
      }
    })

    const launch = Effect.fn("AutonomousEngine.launch")(function* (id: SessionID, state: AutonomousState.Info) {
      yield* stop(id)
      const scope = yield* InstanceState.get(scopes)
      const stopped = Deferred.makeUnsafe<void>()
      const cancelled = Deferred.await(stopped).pipe(Effect.andThen(Effect.interrupt))
      // The legacy goal pause path (Stop, other slash commands) releases this token; treat that as a pause request.
      const current = GoalState.start(id, () => {
        if (!settling.has(id)) Deferred.doneUnsafe(stopped, Effect.void)
      })
      KiloHeadless.mark(id)
      const body = drive(id, state).pipe(
        Effect.raceFirst(cancelled),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.gen(function* () {
                yield* Effect.logError("autonomous goal error", { sessionID: id, cause })
                yield* settle(state, "paused", `Engine error: ${Cause.squash(cause) instanceof Error ? (Cause.squash(cause) as Error).message : String(Cause.squash(cause))}`)
              }),
        ),
        Effect.onInterrupt(() => (AutonomousState.active(state.status) ? settle(state, "paused", "Paused by request.") : Effect.void)),
        Effect.ensuring(
          Effect.sync(() => {
            KiloHeadless.clear(id)
            if (current()) GoalState.pause(id, true)
            if (runs.get(id)?.stopped === stopped) runs.delete(id)
          }),
        ),
      )
      const fiber = yield* provide(body).pipe(Effect.forkIn(scope))
      runs.set(id, { fiber, stopped })
    })

    const guard = Effect.fn("AutonomousEngine.guard")(function* (id: SessionID) {
      const session = yield* sessions.get(id).pipe(Effect.mapError(() => new Error("Session not found.")))
      if (session.parentID) return yield* Effect.fail(new Error("Start goals from the main session, not a delegated session."))
      if (session.time.archived || session.revert) return yield* Effect.fail(new Error("Restore the session before starting a goal."))
      return session
    })

    const start = Effect.fn("AutonomousEngine.start")(function* (id: SessionID, objective: string) {
      yield* guard(id)
      const raw = objective.trim()
      if (!raw) return yield* Effect.fail(new Error("Set a goal with /goal <objective> first."))
      const dir = (yield* InstanceState.context).directory
      const resolved = yield* AutonomousIssue.resolve(raw, dir)
      const text = resolved.objective
      if (text.length > 10_000) return yield* Effect.fail(new Error("Keep the goal under 10,000 characters."))
      if (runs.has(id)) return yield* Effect.fail(new Error("A goal is already running. Pause or clear it before starting another."))
      // Stop any previous run before persisting so its pause cannot overwrite the new state.
      yield* stop(id)
      const state = AutonomousState.create({ sessionID: id, objective: text })
      AutonomousLog.record(state, "goal.started", resolved.issue ? { detail: `from ${resolved.issue.url}` } : undefined)
      yield* persist(state)
      yield* launch(id, state)
      return state
    })

    /** Persisted state, with a stale "running" corrected to paused when no loop is live (e.g. after a restart). */
    const status = Effect.fn("AutonomousEngine.status")(function* (id: SessionID) {
      const state = yield* AutonomousStore.load(id).pipe(Effect.orDie)
      if (!state) return undefined
      if (AutonomousState.active(state.status) && !runs.has(id)) {
        state.status = "paused"
        state.reason = state.reason ?? "Paused after a restart. Use /goal resume to continue."
        yield* persist(state)
      }
      return state
    })

    const pause = Effect.fn("AutonomousEngine.pause")(function* (id: SessionID) {
      const live = yield* stop(id)
      const state = yield* status(id)
      if (!state) return yield* Effect.fail(new Error("There is no goal in this session."))
      if (live || AutonomousState.active(state.status)) yield* settle(state, "paused", "Paused by request.")
      return state
    })

    const resume = Effect.fn("AutonomousEngine.resume")(function* (id: SessionID) {
      yield* guard(id)
      const state = yield* status(id)
      if (!state) return yield* Effect.fail(new Error("There is no saved goal to resume."))
      if (runs.has(id)) return yield* Effect.fail(new Error("The goal is already running."))
      if (state.status === "completed") return yield* Effect.fail(new Error("The goal is complete. Start a new one with /goal <objective>."))
      state.status = state.tasks.length ? "running" : "planning"
      state.reason = undefined
      for (const t of state.tasks) {
        if (t.status === "running" || t.status === "verifying") t.status = "repairing"
        // A blocked goal is resumed to retry: failed tasks get a fresh local attempt budget, blocked dependents reopen.
        if (t.status === "failed") {
          t.status = "repairing"
          t.attempts = 0
          t.escalated = false
        }
        if (t.status === "blocked") t.status = "pending"
      }
      AutonomousLog.record(state, "goal.resumed")
      yield* persist(state)
      yield* launch(id, state)
      return state
    })

    const clear = Effect.fn("AutonomousEngine.clear")(function* (id: SessionID) {
      yield* stop(id)
      yield* AutonomousStore.remove(id).pipe(Effect.orDie)
      const session = yield* sessions.get(id).pipe(Effect.option)
      if (session._tag === "None") return
      const metadata = { ...session.value.metadata }
      delete metadata["kilo.goal"]
      yield* sessions.setMetadata({ sessionID: id, metadata })
    })

    const notice = Effect.fn("AutonomousEngine.notice")(function* (input: CommandInput, text: string) {
      const out = yield* post(input.sessionID, text, input)
      yield* events.publish(Command.Event.Executed, { name: "goal", sessionID: input.sessionID, arguments: input.arguments, messageID: out.info.id })
      return out
    })

    /** `/goal` handling when the engine is enabled. */
    const command = Effect.fn("AutonomousEngine.command")(function* (input: CommandInput) {
      const id = input.sessionID
      const args = input.arguments.trim()
      const word = args.toLowerCase()
      if (word === "" || word === "status") {
        const state = yield* status(id)
        return yield* notice(input, state ? AutonomousStatus.render(state) : AutonomousStatus.help)
      }
      if (word === "tasks") {
        const state = yield* status(id)
        return yield* notice(input, state ? AutonomousStatus.tasks(state) : AutonomousStatus.help)
      }
      if (word === "budget") {
        const state = yield* status(id)
        return yield* notice(input, state ? AutonomousStatus.budget(state) : AutonomousStatus.help)
      }
      if (word === "pause") {
        yield* pause(id)
        return yield* notice(input, "Goal paused after the current step. Use /goal resume to continue.")
      }
      if (word === "resume") {
        const state = yield* resume(id)
        return yield* notice(input, `Goal resumed (${state.tasks.filter((t) => t.status === "completed").length}/${state.tasks.length} tasks done).`)
      }
      if (word === "clear") {
        yield* clear(id)
        return yield* notice(input, "Goal cleared.")
      }
      const objective = args.startsWith("-- ") ? args.slice(3).trim() : args
      yield* start(id, objective)
      return yield* notice(
        input,
        `Autonomous goal started. The engine plans, implements task by task, verifies with checks and review, and reports here when done. Use /goal status to follow progress, /goal pause to stop.`,
      )
    })

    return {
      command: (input: CommandInput) => provide(command(input)),
      start: (id: SessionID, objective: string) => provide(start(id, objective)),
      pause: (id: SessionID) => provide(pause(id)),
      resume: (id: SessionID) => provide(resume(id)),
      clear: (id: SessionID) => provide(clear(id)),
      status: (id: SessionID) => provide(status(id)),
      stop,
      running: (id: SessionID) => runs.has(id),
    }
  })

  export type Interface = Effect.Success<ReturnType<typeof make>>
}
