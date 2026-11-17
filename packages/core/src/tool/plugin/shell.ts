export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Shell as ShellSchema } from "@opencode/schema/shell"
import type { Tool } from "@opencode/schema/tool"
import { Clock, Deferred, Duration, Effect, Fiber, Option, Schema, Struct } from "effect" // kilocode_change - Duration
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../../session/message.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"
import { toolFailure } from "../runtime.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
// How long a call the user interrupted waits for its stopped command to exit before settling with the output so far.
const INTERRUPT_WAIT = "500 millis"

const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when the command finishes. The notification will include the command's output. Unless the user explicitly asks otherwise, DO NOT poll for completion, even if you need the final result to continue. Repeatedly sleeping and reading or searching the output file is polling, not useful work. You may read the current output if it lets you do useful work now, but do not repeatedly check it while waiting for the command to finish. Keep working on anything that does not depend on the result. If you have nothing else to do, end your response; you will be resumed automatically when the command finishes."
const OS =
  process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : process.platform === "linux"
        ? "Linux"
        : process.platform
const description = (shell?: string, autoBackground = false) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    autoBackground
      ? "Commands still running after their timeout move to the background."
      : "Commands accept an optional timeout, background commands have no timeout by default.",
    "Background commands return immediately, and you will be notified when they complete.",
  ].join(" ")

const input = (autoBackground: boolean) =>
  Schema.Struct({
    // kilocode_change start - model-written summary shown instead of the raw command in the tool card.
    // Required: models such as Claude skip an optional summary, so their cards showed bare `cd <worktree> && ...` rows.
    // It comes first: models write arguments in schema order, so the card can show it before the command streams.
    description: Schema.String.annotate({
      description:
        "A clear, concise description of what this command does in 5-10 words, shown as the title of the tool card. Examples: 'Shows working tree status', 'Runs the core package tests', 'Installs package dependencies'.",
    }),
    // kilocode_change end
    command: Schema.String.annotate({ description: "Shell command string to execute" }),
    workdir: Schema.optionalKey(Schema.String).annotate({
      description:
        "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
    }),
    timeout: Schema.optionalKey(NonNegativeInt).annotate({
      description: autoBackground
        ? `Optional timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}). When it expires, a foreground command moves to the background and a background command is stopped.`
        : `Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to ${DEFAULT_TIMEOUT_MS} for foreground commands. Background commands have no timeout by default.`,
    }),
    background: Schema.optionalKey(Schema.Boolean).annotate({
      description:
        "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
    }),
  })

export const Input = input(false)

const StructuredOutput = Schema.Struct({
  output: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  wallTimeSeconds: Schema.Number,
  outputPath: Schema.optionalKey(Schema.String),
  signal: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  pid: Schema.optionalKey(NonNegativeInt),
})

type Output = ReturnType<typeof ShellResult.output> & {
  status: "completed" | "running"
  wallTimeSeconds: number
  outputPath?: string
  shellID?: string
  pid?: number
}

// kilocode_change start - live output preview for tool progress while a command runs
const LIVE_OUTPUT_LIMIT = 30_000
const LIVE_OUTPUT_INTERVAL = Duration.millis(100)
// kilocode_change end

const resultMessages = (output: Output, timeout?: number) => {
  const notice = output.status === "running" ? BACKGROUND_INSTRUCTION : ShellResult.notice(output, timeout)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : [])]
}

const toolResult = (output: Output, timeout?: number, description?: string) => { // kilocode_change - carries the description
  return {
    output: {
      ...Struct.omit(output, ["exit", "status", "truncated", "timeout", "killed"]),
      exitCode: output.exit ?? null,
    },
    content: resultMessages(output, timeout).map((text) => ({
      type: "text" as const,
      text,
    })),
    metadata: {
      status: output.status,
      ...ShellResult.metadata(output),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
      ...(output.pid !== undefined ? { pid: output.pid } : {}),
      ...(description ? { description } : {}), // kilocode_change - keep the summary for clients without the input
    },
  }
}

const wallTimeSeconds = (time: ShellSchema.Time, end: number) => Math.max(0, end - time.started) / 1_000

const backgroundText = (info: ShellSchema.Info, timeout?: number) =>
  [
    `Command moved to the background (shell ID: ${info.id}).`,
    ...(info.pid === undefined ? [] : [`PID: ${info.pid}`]),
    `Output is streaming to: ${info.file}`,
    ...(timeout === undefined
      ? []
      : [
          "",
          `The command did not finish within its timeout of ${timeout / 1_000} seconds and was moved to the background. Do not start another copy while it is running.`,
        ]),
  ].join("\n")

const backgroundResult = (info: ShellSchema.Info, now: number, timeout?: number) => ({
  output: backgroundText(info, timeout),
  wallTimeSeconds: wallTimeSeconds(info.time, now),
  shellID: info.id,
  outputPath: info.file,
  ...(info.pid === undefined ? {} : { pid: info.pid }),
  truncated: false,
  status: "running" as const,
})

// Tells the session how a background command ended, once its job settles.
const notify = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "synthetic">,
  jobs: Job.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly id: string
    readonly shellID: string
    readonly command: string
    readonly description?: string // kilocode_change - the model's summary
    readonly settled: Deferred.Deferred<Output>
  },
) {
  const info = (yield* jobs.wait({ id: input.id })).info
  if (!info || info.status === "running") return
  const output = info.status === "completed" ? yield* Deferred.await(input.settled) : undefined
  const text = output ? (info.output ?? "") : info.status === "error" ? (info.error ?? "Command failed") : "Cancelled"
  // A session deleted while its command ran has no one left to tell.
  yield* sessions
    .synthetic({
      ...(info.notificationID ? { id: info.notificationID } : {}),
      sessionID: input.sessionID,
      description: input.description || input.command, // kilocode_change - prefer the model's description over the raw command
      ...ShellResult.notification({
        jobID: input.id,
        shellID: input.shellID,
        command: input.command,
        state: info.status,
        text,
        output,
      }),
    })
    .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.void))
  if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
})

// The job that waits on a command for its call (or its session, once backgrounded).
const startJob = Effect.fnUntraced(function* (
  jobs: Job.Interface,
  shell: Shell.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly info: ShellSchema.Info
    readonly background?: boolean
    readonly notificationID?: SessionMessage.ID
    readonly timeout?: () => number
    readonly description?: string // kilocode_change - the model's summary
  },
) {
  const info = input.info
  const settled = yield* Deferred.make<Output>()
  const job = yield* jobs.start({
    // CodeMode children share a tool-call ID, but each shell must own its job.
    id: info.id,
    type: name,
    title: info.command,
    metadata: { sessionID: input.sessionID, shellID: info.id },
    recovery: {
      kind: "shell",
      sessionID: input.sessionID,
      shellID: info.id,
      command: info.command,
      ...(input.description ? { description: input.description } : {}), // kilocode_change - the restart notice
    },
    ...(input.notificationID ? { notificationID: input.notificationID } : {}),
    background: input.background,
    run: Effect.gen(function* () {
      const result = yield* shell.result(info)
      if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
      const completed = result.info.time.completed ?? (yield* Clock.currentTimeMillis)
      return {
        ...ShellResult.output(result),
        status: "completed" as const,
        wallTimeSeconds: wallTimeSeconds(result.info.time, completed),
        ...(result.capture.truncated ? { outputPath: result.info.file } : {}),
      }
    }).pipe(
      Effect.tap((output) => Deferred.succeed(settled, output)),
      Effect.map((output) => resultMessages(output, input.timeout?.()).join("\n\n")),
      // Interrupting the job (its registry closing) stops the command too, unless the server is handing its daemon
      // over: then the command keeps running for the next server.
      Effect.onInterrupt(() =>
        shell.handoffPrepared() ? Effect.void : shell.stop(info.id, "killed").pipe(Effect.ignore, Effect.asVoid),
      ),
    ),
    // Cancelling the job stops the command, keeping it and its output file.
    cancel: shell.stop(info.id, "killed").pipe(Effect.ignore, Effect.asVoid),
  })
  return { job, settled }
})

/** The tool result of a call whose command moved to the background. */
export const backgroundToolResult = (info: ShellSchema.Info) => {
  // Narrowed to what a backgrounded command reports, so it can be published as is.
  const metadata = {
    shellID: info.id,
    status: "running" as const,
    truncated: false,
    ...(info.pid === undefined ? {} : { pid: info.pid }),
  }
  return {
    content: [backgroundText(info), BACKGROUND_INSTRUCTION].map((text) => ({
      type: "text" as const,
      text,
    })),
    metadata,
  }
}

/**
 * Watches a command taken over from a previous server as a background job of its session, and notifies the
 * session when it finishes, as for a command the model ran in the background. A finished command's notice is
 * admitted before this returns.
 */
export const reattach = Effect.fnUntraced(function* (input: {
  readonly shell: Shell.Interface
  readonly jobs: Job.Interface
  readonly sessions: Pick<Session.Interface, "synthetic">
  readonly sessionID: SessionSchema.ID
  readonly info: ShellSchema.Info
  // The job's existing durable row, if the previous server had backgrounded it.
  readonly notificationID?: SessionMessage.ID
}) {
  const { job, settled } = yield* startJob(input.jobs, input.shell, { ...input, background: true })
  const notifying = notify(input.sessions, input.jobs, {
    sessionID: input.sessionID,
    id: job.id,
    shellID: input.info.id,
    command: input.info.command,
    settled,
  })
  const current = yield* input.shell.get(input.info.id).pipe(Effect.option)
  if (Option.isSome(current) && current.value.status !== "running")
    return yield* notifying.pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to report a recovered shell command", { id: input.info.id, error }),
      ),
    )
  yield* input.shell.watch(notifying)
})

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    const permission = yield* Permission.Service
    const autoBackground = yield* Flag.enabled("shell_timeout_background")

    const prepare = Effect.fn("ShellTool.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
      const target = yield* access.resolve({ path: invocation.cwd, kind: "directory" })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute)
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        access.resolve({
          path: FileAccess.resolvePath(target.absolute, directory),
          kind: "directory",
        }),
      )
      yield* access.authorizeExternal([target, ...directories], context)
      if (parsed.commands.length > 0)
        yield* permission.assert({
          action: name,
          resources: parsed.commands.map((command) => command.resource),
          save: parsed.commands.map((command) => command.save),
          ...Permission.invocation(context),
        })
      // Approval can outlive the directory, so validate immediately before spawning.
      const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () =>
          Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
        ),
      )
      if (workdir !== "directory")
        return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
      return timeout
    })

    // Not in this Location's scope: a daemon command outlives a Location that closes while the server runs, and
    // its session must still hear how it ended.
    const notifyWhenDone = (
      sessionID: SessionSchema.ID,
      id: string,
      shellID: string,
      command: string,
      description: string | undefined, // kilocode_change
      settled: Deferred.Deferred<Output>,
    ) => shell.watch(notify(sessions, jobs, { sessionID, id, shellID, command, description, settled })) // kilocode_change - carries the summary

    // Stops the command of a call the user asked to stop, and fails the call with the output so far. The command
    // stays observable, output file included.
    const cancelled = Effect.fnUntraced(function* (info: ShellSchema.Info, jobID: string) {
      yield* shell.stop(info.id, "killed").pipe(Effect.ignore)
      // The stop escalates to SIGKILL on its own; the session does not wait for that to settle the call.
      const result = yield* shell.result(info, { wait: INTERRUPT_WAIT })
      // The stopped job settles from the same exit; this only releases it.
      yield* jobs.cancel(jobID)
      const stopped = ShellResult.interrupted(result)
      return yield* new ToolFailure({
        message: stopped.message,
        // The notice ends the message; renderers show what precedes it as the output, like a finished call's.
        metadata: {
          interrupted: true,
          truncated: result.capture?.truncated ?? false,
          shellID: info.id,
          notice: stopped.notice,
        },
      })
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(undefined, autoBackground),
          input: input(autoBackground),
          output: StructuredOutput,
          execute: (input, context) => {
            // With timeout backgrounding, a foreground timeout of 0 falls back to the default so a call can't block
            // until the command exits.
            const foreground = autoBackground
              ? input.timeout || DEFAULT_TIMEOUT_MS
              : (input.timeout ?? DEFAULT_TIMEOUT_MS)
            const timeout = input.background === true ? (input.timeout ?? 0) : foreground
            let finalTimeout = timeout
            let stopStreaming: Effect.Effect<void> = Effect.void // kilocode_change - the live preview fiber
            // Uninterruptible from spawning to blocking, so an interrupt cannot orphan a started command.
            return Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                // Listens for the user's stop for the whole call, starting before the command does, so a stop always
                // reaches this tool through `cancel` instead of interrupting it, even while the command starts.
                const stopped = yield* Deferred.make<void>()
                const listener = context.cancel
                  ? yield* context.cancel.pipe(
                      Effect.andThen(Deferred.succeed(stopped, undefined)),
                      Effect.interruptible,
                      Effect.forkChild({ startImmediately: true }),
                    )
                  : undefined
                return yield* Effect.gen(function* () {
                  const info = yield* shell.create(
                    {
                      command: input.command,
                      cwd: input.workdir,
                      timeout,
                      shell: yield* compatibleShell,
                      metadata: { sessionID: context.sessionID },
                      waited: input.background !== true,
                      toolCall: {
                        sessionID: context.sessionID,
                        assistantMessageID: context.messageID,
                        callID: context.id,
                      },
                    },
                    (invocation) =>
                      Effect.gen(function* () {
                        invocation.env.AGENT = "1"
                        invocation.env.OPENCODE = "1"
                        invocation.env.AI_AGENT ||= "opencode"
                        invocation.env.OPENCODE_SESSION_ID = context.sessionID
                        // Asking for permission can take a while; a stop then ends the call before any command starts.
                        finalTimeout = yield* restore(
                          Effect.raceFirst(
                            prepare(invocation, context),
                            Deferred.await(stopped).pipe(
                              Effect.andThen(
                                Effect.fail(
                                  new ToolFailure({ message: "Command interrupted by the user before it started." }),
                                ),
                              ),
                            ),
                          ),
                        )
                        // A foreground timeout moves the command to the background instead of stopping it.
                        if (autoBackground && input.background !== true) invocation.timeout = 0
                      }),
                  )
                  yield* context.progress({ shellID: info.id })

                  // kilocode_change start - stream the current output and running state while the command runs
                  const size = Effect.gen(function* () {
                    return (yield* shell.output(info.id, { cursor: Number.MAX_SAFE_INTEGER })).size
                  })
                  const preview = (bytes: number) =>
                    Effect.gen(function* () {
                      // Four bytes per character covers any UTF-8 code point, so the window holds at least the limit.
                      const start = Math.max(0, bytes - LIVE_OUTPUT_LIMIT * 4)
                      const page = yield* shell.output(info.id, { cursor: start, limit: bytes - start })
                      const text = start > 0 ? page.output.replace(/^\uFFFD+/, "") : page.output
                      return text.length <= LIVE_OUTPUT_LIMIT ? text : `...\n\n${text.slice(-LIVE_OUTPUT_LIMIT)}`
                    })
                  const report = (output: string) =>
                    context.progress({ shellID: info.id, output, status: "running" })
                  let seen = yield* size.pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(0)))
                  let published = yield* preview(seen)
                  yield* report(published)
                  // The child fiber stops on every normal return below; an interrupted or failed call interrupts it
                  // with the tool fiber, so no path leaves it publishing after the call settles.
                  const streamed = yield* Effect.forkChild(
                    Effect.gen(function* () {
                      while (true) {
                        yield* Effect.sleep(LIVE_OUTPUT_INTERVAL)
                        const bytes = yield* size
                        // The output file is append-only, so an unchanged size means an unchanged preview.
                        if (bytes === seen) continue
                        seen = bytes
                        const output = yield* preview(bytes)
                        if (output === published) continue
                        published = output
                        yield* report(output)
                      }
                    }).pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.void)),
                  )
                  stopStreaming = Fiber.interrupt(streamed) // kilocode_change
                  // kilocode_change end

                  const { job, settled } = yield* startJob(jobs, shell, {
                    sessionID: context.sessionID,
                    info,
                    timeout: () => finalTimeout,
                    ...(input.description ? { description: input.description } : {}), // kilocode_change
                  })
                  // Stopped while the command was starting: stop it now.
                  if (yield* Deferred.isDone(stopped)) return yield* cancelled(info, job.id)

                  if (input.background === true) {
                    yield* jobs.background(job.id)
                    yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, input.description, settled) // kilocode_change
                    return backgroundResult(info, yield* Clock.currentTimeMillis)
                  }

                  const waiting = jobs.block({ id: job.id, sessionID: context.sessionID })
                  const blocked =
                    autoBackground && finalTimeout > 0
                      ? waiting.pipe(
                          Effect.timeoutOption(finalTimeout),
                          Effect.flatMap((result) =>
                            Option.isSome(result)
                              ? Effect.succeed(result.value)
                              : jobs
                                  .background(job.id)
                                  .pipe(
                                    Effect.map((info) =>
                                      info ? { type: "backgrounded" as const, info, timedOut: true } : undefined,
                                    ),
                                  ),
                          ),
                        )
                      : waiting
                  // A user's stop arrives through `cancel`. Any interrupt stops the command too, unless the server is
                  // handing its daemon over: then the command and its job keep running, and the next server takes the
                  // call over and moves the command to the background.
                  const outcome = yield* restore(
                    Effect.raceFirst(
                      blocked.pipe(Effect.map((result) => ({ type: "settled" as const, result }))),
                      Deferred.await(stopped).pipe(Effect.as({ type: "cancelled" as const })),
                    ),
                  ).pipe(
                    Effect.onInterrupt(() =>
                      shell.handoffPrepared() ? Effect.void : jobs.cancel(job.id).pipe(Effect.ignore),
                    ),
                  )
                  if (outcome.type === "cancelled") return yield* cancelled(info, job.id)
                  const result = outcome.result
                  if (result?.type === "backgrounded") {
                    yield* shell.timeout(info.id, 0)
                    const elapsed = "timedOut" in result ? finalTimeout : undefined
                    finalTimeout = 0
                    yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, input.description, settled) // kilocode_change
                    return backgroundResult(info, yield* Clock.currentTimeMillis, elapsed)
                  }
                  if (result?.info.status === "error")
                    return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
                  if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

                  return yield* Deferred.await(settled)
                }).pipe(Effect.ensuring(Effect.suspend(() => stopStreaming)), Effect.ensuring(listener ? Fiber.interrupt(listener) : Effect.void)) // kilocode_change - stop the live preview
              }),
            ).pipe(
              // Shell spans, including the job that waits for a backgrounded command, name the call that started them.
              Effect.annotateSpans({
                "gen_ai.tool.call.id": context.id,
                ...(input.background === true ? { "opencode.shell.background": true } : {}),
              }),
              Effect.map((output) => toolResult(output, finalTimeout, input.description)), // kilocode_change
              Effect.mapError(toolFailure(`Unable to execute command: ${input.command}`)),
            )
          },
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(ShellSelect.name(yield* compatibleShell), autoBackground)
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
