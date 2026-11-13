export * as KiloSandbox from "./index"

import { CurrentProxyFactory, enabled, startProxy, type ProxyFactory } from "@kilocode/sandbox"
import { Config } from "@opencode/core/config"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { ShellParse } from "@opencode/core/shell/parse"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"
import type { ListCursor } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import { Context, Effect, Option, Ref, Stream } from "effect"
import * as SandboxActivation from "./activation"
import { SandboxConfig } from "./config"
import { marker, register, release } from "./environment"
import { mutates } from "./git"
import { hiddenTools, isMcp } from "./network"
import * as SandboxPolicy from "./policy"
import { Runtime, type Interface as RuntimeInterface, type Target } from "./runtime"

export { layer as environment } from "./environment"

/** The tool call a sandboxed execution belongs to, for the shell hook's escalation prompt. */
const CurrentCall = Context.Reference<Tool.Context | undefined>("@kilocode/kilo-plugin/SandboxCall", {
  defaultValue: () => undefined,
})

/** Launch tokens registered during one tool call; released when the call ends. */
const CurrentLaunches = Context.Reference<Set<string> | undefined>("@kilocode/kilo-plugin/SandboxLaunches", {
  defaultValue: () => undefined,
})

/** Tools that create their own sessions; each child session applies its own sandbox state. */
const delegating = new Set(["subagent"])

export const Plugin = define({
  id: "kilocode.sandbox",
  effect: Effect.fn(function* (ctx) {
    // Location services: the supervisor provides them to host plugins, outside the plugin's typed requirements.
    const config = yield* Effect.serviceOption(Config.Service)
    const sessionService = yield* Effect.serviceOption(Session.Service)
    const jobService = yield* Effect.serviceOption(Job.Service)
    if (Option.isNone(config) || Option.isNone(sessionService) || Option.isNone(jobService))
      return yield* Effect.die(new Error("Kilo sandbox requires location services"))
    const sessions = sessionService.value
    const jobs = jobService.value
    const global = yield* Global.Service
    // Per Location: each Location has its own tool registry and its own plugin instance.
    const wrapped = new Set<string>()
    /** MCP tools: delegated authority that needs unrestricted network. */
    const delegated = new Set<string>()
    /** Tools a network-restricted session does not offer, filled from this Location's registry below. */
    let hidden = hiddenTools([])
    const emit = yield* Ref.make<(event: KiloSandboxRpc.Changed) => Effect.Effect<void>>(() => Effect.void)

    const runtime: RuntimeInterface = {
      directory: ctx.location.directory,
      worktree: ctx.location.project.directory,
      config: config.value.entries().pipe(Effect.map((entries) => SandboxConfig.fromEntries(entries, global.config))),
      session: (sessionID) => sessions.get(sessionID).pipe(Effect.option, Effect.map(Option.getOrUndefined)),
      // Every direct child: a family larger than one page must not skip children.
      children: (sessionID) => {
        const page = (cursor?: ListCursor): Effect.Effect<Target[]> =>
          sessions.list({ parentID: sessionID, ...(cursor ? { cursor } : {}) }).pipe(
            Effect.flatMap((result) => {
              const items = result.data.map((child) => ({ id: child.id, directory: child.location.directory }))
              if (!result.cursor.next || result.data.length === 0) return Effect.succeed(items)
              return page(result.cursor.next).pipe(Effect.map((rest) => [...items, ...rest]))
            }),
            Effect.orElseSucceed(() => []),
          )
        return page()
      },
      active: sessions.active,
      background: jobs.runningBackground.pipe(
        Effect.map(
          (items) =>
            new Set(
              items.flatMap((item) =>
                "sessionID" in item ? [item.sessionID] : [item.parentSessionID, item.childSessionID],
              ),
            ),
        ),
      ),
      publish: (event) => Effect.flatMap(Ref.get(emit), (publish) => publish(event)),
    }
    const provide = Effect.provideService(Runtime, runtime)

    // One network proxy per allowed-host policy for the Location's lifetime. A background shell command keeps using
    // the proxy after its tool call returns; the proxies stop when the Location (or the server) shuts down.
    const proxies = new Map<string, ReturnType<ProxyFactory>>()
    const proxy: ProxyFactory = (hosts) => {
      const key = hosts.join("\0")
      const existing = proxies.get(key)
      if (existing) return existing.then((runtime) => ({ ...runtime, close: async () => {} }))
      const started = startProxy(hosts)
      proxies.set(key, started)
      started.catch(() => proxies.delete(key))
      return started.then((runtime) => ({ ...runtime, close: async () => {} }))
    }
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        Promise.allSettled([...proxies.values()].map((started) => started.then((runtime) => runtime.close()))),
      ),
    )

    const exists = (sessionID: KiloSandboxRpc.Changed["sessionID"]) =>
      sessions.get(sessionID).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )

    const registration = yield* ctx.rpc
      .register(KiloSandboxRpc.Definition, {
        support: () => SandboxPolicy.configuredSupport().pipe(provide),
        status: (input, context) =>
          Effect.gen(function* () {
            if (!(yield* exists(input.sessionID))) return yield* Effect.fail(context.error("not_found", "Unknown session"))
            return yield* SandboxPolicy.status(input.sessionID).pipe(provide)
          }),
        toggle: (input, context) =>
          Effect.gen(function* () {
            if (!(yield* exists(input.sessionID))) return yield* Effect.fail(context.error("not_found", "Unknown session"))
            const busy = context.error(
              "busy",
              "Stop the active session and its subagents before enabling sandbox confinement",
            )
            const inactive = (family: readonly SandboxPolicy.Target[]) =>
              SandboxActivation.idle(input.sessionID, family).pipe(
                Effect.flatMap((idle) => (idle ? Effect.void : Effect.fail(busy))),
              )
            return yield* SandboxPolicy.toggleGuarded(
              input.sessionID,
              (enabling, family) => (enabling ? inactive(family) : Effect.void),
              SandboxActivation.family(input.sessionID),
              inactive,
            ).pipe(provide)
          }),
      })
      .pipe(Effect.orDie)
    yield* Ref.set(emit, (event) => registration.events.emit("changed", event).pipe(Effect.ignore))

    // kilo_port(sandbox:41a5c4f8070a) Every tool call runs under its session's sandbox state.
    yield* ctx.tool
      .transform((editor) => {
        delegated.clear()
        hidden = hiddenTools(editor.list())
        for (const item of editor.list()) {
          if (delegating.has(item.id)) continue
          editor.update(item.id, (tool) => {
            const execute = tool.execute
            const id = item.id
            const name = item.name
            const mcp = isMcp(item) // kilo_port(sandbox:b534aff3ebec)
            if (mcp) delegated.add(id)
            tool.execute = (input, context) => {
              const launches = new Set<string>()
              return SandboxPolicy.executeTool(context.sessionID, { id, name, mcp }, execute(input, context)).pipe(
                Effect.provideService(CurrentCall, context),
                Effect.provideService(CurrentLaunches, launches),
                Effect.provideService(CurrentProxyFactory, proxy),
                Effect.ensuring(Effect.sync(() => launches.forEach(release))),
                provide,
                Effect.mapError((error) =>
                  error instanceof Tool.Error ? error : new Tool.Error({ message: describe(error), error }),
                ),
              )
            }
            wrapped.add(id)
          })
        }
      })
      .pipe(Effect.orDie)

    // A tool registered after the wrapper (a later plugin) has no sandbox profile; refuse it while the session is
    // sandboxed instead of running it outside the sandbox.
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        if (wrapped.has(event.tool) || delegating.has(event.tool) || event.tool === "execute") return
        const status = yield* SandboxPolicy.status(event.sessionID).pipe(provide)
        if (!status.enabled) return
        return yield* Effect.fail(
          new Tool.Error({ message: `Sandbox cannot confine the tool ${event.tool}; disable the sandbox to use it` }),
        )
      }),
    )

    // kilo_port(sandbox:37cf5fea540a) Shell commands of a sandboxed tool call spawn inside the sandbox. A command
    // that mutates Git needs host access (the sandbox denies writes to `.git`): the user can approve it once to run
    // outside the sandbox.
    yield* ctx.shell.hook("create.before", (invocation) =>
      Effect.gen(function* () {
        if (!(yield* enabled)) return
        const call = yield* CurrentCall
        if (call && (yield* escalate(invocation))) {
          const approved = yield* ctx.permission
            .assert({
              sessionID: call.sessionID,
              agent: call.agent,
              action: "sandbox_escalation",
              resources: [invocation.command],
              save: [],
              // `interactive`: headless runs (`run --auto`) reject the request instead of approving it.
              metadata: { command: invocation.command, sandboxEscalation: true, interactive: true },
              source: { type: "tool", messageID: call.messageID, id: call.id },
            })
            .pipe(
              Effect.as(true),
              Effect.catchTag("Tool.Error", () => Effect.succeed(false)),
            )
          if (approved) return
        }
        const token = yield* register
        invocation.env[marker] = token
        ;(yield* CurrentLaunches)?.add(token)
      }),
    )

    // kilo_port(sandbox:4918d15ae745) A network-restricted session does not offer MCP tools, MCP resources or Code
    // Mode (which calls MCP tools) to the model; a call would fail closed anyway.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const status = yield* SandboxPolicy.status(event.sessionID).pipe(provide, Effect.orElseSucceed(() => undefined))
        if (!status?.network) return
        for (const id of Object.keys(event.tools))
          if (delegated.has(id) || hidden.has(id)) delete event.tools[id]
      }),
    )

    // Sandbox escalation always asks a person; saved or wildcard rules do not approve host access.
    // Code Mode `fetch` asks the webfetch permission and fetches directly, so a restricted session denies it here.
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        if (event.action === "sandbox_escalation") {
          if (event.effect === "allow") event.effect = "ask"
          return
        }
        if (event.action !== "webfetch" || event.effect === "deny") return
        const status = yield* SandboxPolicy.status(event.sessionID).pipe(provide, Effect.orElseSucceed(() => undefined))
        if (!status?.network) return
        event.effect = "deny"
        event.message = "Sandbox denied outbound network access"
      }),
    )

    yield* ctx.event.subscribe().pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === "config.updated") return SandboxPolicy.configChanged()
          if (event.type === "session.moved")
            return yield* SandboxPolicy.move(event.data.sessionID, runtime.directory, event.data.location.directory)
          if (event.type === "session.deleted")
            yield* SandboxPolicy.dispose(event.data.sessionID, Effect.void).pipe(provide)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

function describe(error: unknown) {
  if (typeof error === "object" && error !== null && "description" in error && typeof error.description === "string")
    return error.description
  return error instanceof Error ? error.message : String(error)
}

function escalate(invocation: { command: string; shell: string; cwd: string }) {
  return ShellParse.scan(invocation.command, invocation.shell, invocation.cwd).pipe(
    Effect.map((parsed) => parsed.commands.some((command) => mutates(command.resource))),
    Effect.orElseSucceed(() => mutates(invocation.command)),
  )
}
