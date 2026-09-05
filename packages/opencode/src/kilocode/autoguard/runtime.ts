import { selection, respond } from "./scripted"
import { Effect, Exit, Cause } from "effect"
import { backendSupport, current, run, withRunner, mutate, type Profile } from "@kilocode/sandbox"
import { InstanceState } from "@/effect/instance-state"
import { Question } from "@/question"
import type { Tool } from "@/tool/tool"
import { AutoGuardDenied } from "./plugin"
import { registered, installAdapter, type Prepared } from "./controller"
import { canonical, digest } from "./resources"
import { intersect } from "./profile"

installAdapter()

import { Observation } from "./observation"
export { event, check } from "./observation"
export function enabled() {
  return Effect.gen(function* () {
    return !!registered(yield* InstanceState.directory)
  })
}
export function inherit(parent: string, child: string) {
  return Effect.gen(function* () {
    registered(yield* InstanceState.directory)?.inherit(parent, child)
  })
}
function confinement(prepared: Prepared): Profile {
  const value = prepared.profile
  const protectedPaths = value.denied_paths
  return {
    filesystem: {
      allowWrite: value.write_roots.map((p) => ({
        path: canonical(p, prepared.ir.cwd),
        kind: prepared.ir.actions.some((a) => a.resources?.some((r) => r.key === p && r.kind === "file"))
          ? ("literal" as const)
          : ("subtree" as const),
      })),
      denyWrite: protectedPaths.map((p) => ({ path: canonical(p, prepared.ir.cwd), kind: "subtree" as const })),
      denyNames: [".git"],
      temporaryDirectory: value.environment.TMPDIR,
    },
    network: { mode: value.network, allowedHosts: value.allowed_hosts },
    environment: {
      deny: [
        "PYTHONPATH",
        "PYTHONSTARTUP",
        "BASH_ENV",
        "ENV",
        "NODE_OPTIONS",
        "AUTOGUARD_L1_API_KEY",
        "OPENROUTER_API_KEY",
      ],
      set: value.environment,
    },
  }
}

/** Runs after final plugin argument hooks, inside the native sandbox ceiling. */
export function execute<A, E, R>(
  ctx: Tool.Context,
  tool: { id: string },
  args: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const controller = registered(yield* InstanceState.directory)
    if (!controller) return yield* effect
    if ((yield* Observation)?.call === ctx.callID) return yield* effect
    const call = {
      ...controller.finalize(ctx.sessionID, {
        tool: tool.id,
        arguments: structuredClone(args),
        callID: ctx.callID ?? ctx.messageID,
      }),
      callID: ctx.callID ?? ctx.messageID,
    }
    if (/^(bash|shell)$/.test(tool.id) && typeof call.arguments.command === "string")
      args.command = call.arguments.command
    let prepared = yield* Effect.promise(() => controller.prepare(ctx.sessionID, call))
    if (!controller.options.observe && prepared.result.decision === "deny") {
      if (prepared.pending?.missing_facts.includes("repeated_denial")) {
        const request = prepared.pending
        controller.event("waiting_user", ctx.sessionID, call.callID, {
          request_id: request.id,
          fingerprint: request.fingerprint,
          missing_facts: request.missing_facts,
        })
        const questions = yield* Effect.serviceOption(Question.Service)
        if (process.env.AUTOGUARD_INTERACTION !== "autonomous" && questions._tag === "Some") {
          yield* questions.value
            .ask({
              sessionID: ctx.sessionID,
              blocking: true,
              questions: [
                {
                  header: "AutoGuard",
                  question: request.question,
                  options: [{ label: "Продолжить безопасным путём", description: "Текущий запрет сохраняется" }],
                },
              ],
            })
            .pipe(Effect.onExit(() => Effect.sync(() => controller.answer(prepared, false))))
        }
      }
      return yield* Effect.die(new AutoGuardDenied(prepared.result))
    }
    if (!controller.options.observe && prepared.result.decision === "ask") {
      const request = prepared.pending!
      controller.event("waiting_user", ctx.sessionID, call.callID, {
        request_id: request.id,
        missing_facts: request.missing_facts,
        fingerprint: request.fingerprint,
      })
      // Headless autonomous measurements must not impersonate a user.
      if (process.env.AUTOGUARD_INTERACTION === "autonomous") {
        return yield* Effect.die(new Error(`AutoGuard waiting_user: ${request.question}`))
      }
      const questions = yield* Effect.serviceOption(Question.Service)
      if (questions._tag === "None") return yield* Effect.die(new Error(`AutoGuard waiting_user: ${request.question}`))
      const scripted =
        controller.options.scripted && selection(request, controller.options.scripted, prepared.contract.workspace)
      const asking = questions.value
        .ask({
          sessionID: ctx.sessionID,
          blocking: true,
          questions: [
            {
              header: "AutoGuard",
              question: request.question,
              options: request.candidates.length
                ? [
                    { label: "Разрешить", description: "Разрешить только перечисленные операции и цели" },
                    { label: "Отказать", description: "Сохранить текущие ограничения" },
                  ]
                : [
                    {
                      label: "Отменить",
                      description: "Либо введите уточнение задачи; непрозрачное действие не будет исполнено",
                    },
                  ],
            },
          ],
          tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
        })
        .pipe(Effect.onError(() => Effect.sync(() => controller.answer(prepared, false))))
      const answer =
        scripted === undefined
          ? yield* asking
          : (yield* Effect.all([asking, respond(questions.value, ctx.sessionID, call.callID, scripted)], {
              concurrency: 2,
            }))[0]
      const approved =
        request.candidates.length > 0 && answer.length === 1 && answer[0].length === 1 && answer[0][0] === "Разрешить"
      controller.answer(prepared, approved, scripted === undefined ? "user" : "scripted")
      if (
        !approved &&
        answer.length === 1 &&
        answer[0].length === 1 &&
        !["Отменить", "Отказать", "Разрешить"].includes(answer[0][0])
      ) {
        yield* Effect.promise(() =>
          controller.message(
            ctx.sessionID,
            { id: `answer:${request.id}`, text: answer[0][0] },
            prepared.contract.uncertainties?.map((m) => m.id),
          ),
        )
      }
      if (!approved)
        return yield* Effect.die(
          new AutoGuardDenied({ ...prepared.result, decision: "deny", reason: "The user declined this operation" }),
        )
      prepared = yield* Effect.promise(() => controller.prepare(ctx.sessionID, call))
      if (prepared.result.decision !== "allow")
        return yield* Effect.die(new Error(`AutoGuard waiting_user: ${prepared.result.reason}`))
    }
    controller.verify(prepared)
    // A native escalation cannot silently remove AutoGuard's mandatory profile.
    if (ctx.extra) {
      ctx.extra.autoguard = true
      ctx.extra.sandboxed = true
    }
    const parent = yield* current
    const limits = confinement(prepared)
    // Baseline retains native execution restrictions and the same protected audit sink.
    const profile = controller.options.observe
      ? {
          ...limits,
          environment: parent?.environment ?? { deny: ["AUTOGUARD_L1_API_KEY", "OPENROUTER_API_KEY"], set: {} },
          filesystem: {
            ...(parent?.filesystem ?? limits.filesystem),
            denyWrite: [
              ...(parent?.filesystem.denyWrite ?? []),
              ...(controller.context.audit_paths ?? []).map((p) => ({
                path: canonical(p, prepared.ir.cwd),
                kind: "subtree" as const,
              })),
            ],
            allowWrite: parent?.filesystem.allowWrite ?? [
              { path: prepared.contract.workspace, kind: "subtree" as const },
              { path: canonical(prepared.profile.environment.TMPDIR, prepared.ir.cwd), kind: "subtree" as const },
            ],
          },
          network: parent?.network ?? limits.network,
        }
      : intersect(limits, parent)
    if (!backendSupport(profile.network).available)
      return yield* Effect.die(new Error("AutoGuard execution profile unavailable"))
    let started = false
    const observer: Observation = {
      call: call.callID,
      verify() {
        if (digest(args) !== digest(call.arguments)) throw new Error("arguments_changed_before_execution")
        controller.verify(prepared, false)
      },
      emit(kind, detail) {
        if (kind === "execution_started") started = true
        // Process boundaries apply to every normalized operation in the compound call.
        prepared.ir.actions.forEach((_, index) =>
          controller.event(kind, ctx.sessionID, call.callID, {
            ...detail,
            operation_index: index,
            shared_boundary: prepared.ir.actions.length > 1,
          }),
        )
      },
    }
    const observed = withRunner(
      (limits, request) =>
        Effect.gen(function* () {
          // The filesystem decorator already checked native permissions before invoking this runner.
          observer.verify()
          observer.emit("execution_started", { boundary: "filesystem", operation: request.op })
          return yield* mutate(limits, request).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() =>
                observer.emit("execution_finished", {
                  boundary: "filesystem",
                  operation: request.op,
                  success: Exit.isSuccess(exit),
                }),
              ),
            ),
          )
        }),
      effect,
    ).pipe(Effect.provideService(Observation, observer))
    return yield* (
      ["task", "todowrite", "todoread", "question"].includes(tool.id) ? observed : run(profile, observed)
    ).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const output =
            Exit.isSuccess(exit) && exit.value && typeof exit.value === "object"
              ? (exit.value as { metadata?: { exit?: unknown } })
              : undefined
          const code = typeof output?.metadata?.exit === "number" ? output.metadata.exit : null
          controller.finished(
            prepared,
            started ? true : null,
            code,
            Exit.isFailure(exit) ? Cause.pretty(exit.cause).slice(0, 1000) : null,
          )
        }),
      ),
    )
  }).pipe(Effect.orDie)
}
