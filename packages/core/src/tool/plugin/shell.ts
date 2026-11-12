export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Duration, Effect, Fiber, Schema, Scope } from "effect" // kilocode_change - Duration, Fiber
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000

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
const description = (shell?: string) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    "Commands accept an optional timeout, background commands have no timeout by default.",
    "Background commands return immediately, and you will be notified when they complete.",
  ].join(" ")

export const Input = Schema.Struct({
  // kilocode_change start - optional model-written summary shown instead of the raw command in the tool card.
  // It comes first: models write arguments in schema order, so the card can show it before the command streams.
  description: Schema.optionalKey(Schema.String).annotate({
    description:
      "Recommended: a clear, concise description of what this command does in 5-10 words, for the tool card. Omit it only when the command already says what it does.",
  }),
  // kilocode_change end
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.optionalKey(Schema.String).annotate({
    description:
      "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
  }),
  timeout: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to ${DEFAULT_TIMEOUT_MS} for foreground commands. Background commands have no timeout by default.`,
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
  }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  truncated: Schema.Boolean,
  timeout: Schema.optionalKey(Schema.Boolean),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running"])),
})

type Output = typeof Output.Type

// kilocode_change start - live output preview for tool progress while a command runs
const LIVE_OUTPUT_LIMIT = 30_000
const LIVE_OUTPUT_INTERVAL = Duration.millis(100)
// kilocode_change end

const resultMessages = (output: Output) => {
  const notice = output.status === "running" ? BACKGROUND_INSTRUCTION : ShellResult.notice(output)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : [])]
}

const toolResult = (output: Output, description?: string) => { // kilocode_change - carries the optional description
  return {
    output,
    content: resultMessages(output).map((text) => ({ type: "text" as const, text })),
    metadata: {
      status: output.status,
      ...ShellResult.metadata(output),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
      ...(description ? { description } : {}), // kilocode_change - keep the summary for clients without the input
    },
  }
}

const backgroundResult = (shellID: string, file: string) => ({
  output: `Command moved to the background (shell ID: ${shellID}).\nOutput is streaming to: ${file}`,
  shellID,
  truncated: false,
  status: "running" as const,
})

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    const permission = yield* Permission.Service

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

    const notifyWhenDone = Effect.fn("ShellTool.notifyWhenDone")(
      function* (
        sessionID: SessionSchema.ID,
        id: string,
        shellID: string,
        command: string,
        description: string | undefined, // kilocode_change
        settled: Deferred.Deferred<Output>,
      ) {
        const info = (yield* jobs.wait({ id })).info
        if (!info || info.status === "running") return
        const output = info.status === "completed" ? yield* Deferred.await(settled) : undefined
        const text = output
          ? resultMessages(output).join("\n\n")
          : info.status === "error"
            ? (info.error ?? "Command failed")
            : "Cancelled"
        yield* sessions.synthetic({
          ...(info.notificationID ? { id: info.notificationID } : {}),
          sessionID,
          description: description ?? command, // kilocode_change - prefer the model's description over the raw command
          ...ShellResult.notification({
            jobID: id,
            shellID,
            command,
            state: info.status,
            text,
            output,
          }),
        })
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(),
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const timeout = input.background === true ? (input.timeout ?? 0) : (input.timeout ?? DEFAULT_TIMEOUT_MS)
              let finalTimeout = timeout
              const info = yield* shell.create(
                {
                  command: input.command,
                  cwd: input.workdir,
                  timeout,
                  shell: yield* compatibleShell,
                  metadata: { sessionID: context.sessionID },
                },
                (invocation) =>
                  Effect.gen(function* () {
                    invocation.env.AGENT = "1"
                    invocation.env.OPENCODE = "1"
                    invocation.env.AI_AGENT ||= "opencode"
                    invocation.env.OPENCODE_SESSION_ID = context.sessionID
                    finalTimeout = yield* prepare(invocation, context)
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
              const stop = Fiber.interrupt(streamed)
              // kilocode_change end

              const settled = yield* Deferred.make<Output>()
              const run = Effect.gen(function* () {
                const result = yield* shell.result(info)
                if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
                const output = ShellResult.output(result)
                return {
                  ...output,
                  output: output.timeout
                    ? `${output.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.`
                    : output.output,
                  status: "completed" as const,
                }
              }).pipe(
                Effect.tap((output) => Deferred.succeed(settled, output)),
                Effect.map((output) => resultMessages(output).join("\n\n")),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
              )
              const job = yield* jobs.start({
                // CodeMode children share a tool-call ID, but each shell must own its job.
                id: info.id,
                type: name,
                title: info.command,
                metadata: { sessionID: context.sessionID, shellID: info.id },
                recovery: {
                  kind: "shell",
                  sessionID: context.sessionID,
                  shellID: info.id,
                  command: info.command,
                },
                run,
              })

              if (input.background === true) {
                yield* jobs.background(job.id)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, input.description, settled)
                yield* stop // kilocode_change
                return backgroundResult(info.id, info.file)
              }

              const result = yield* jobs
                .block({ id: job.id, sessionID: context.sessionID })
                .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, 0)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, input.description, settled)
                yield* stop // kilocode_change
                return backgroundResult(info.id, info.file)
              }
              if (result?.info.status === "error")
                return yield* stop.pipe(Effect.andThen(Effect.fail(new Error(result.info.error ?? "Command failed")))) // kilocode_change
              if (result?.info.status === "cancelled") // kilocode_change
                return yield* stop.pipe(Effect.andThen(Effect.fail(new Error("Command cancelled")))) // kilocode_change

              return yield* Deferred.await(settled).pipe(Effect.ensuring(stop)) // kilocode_change
            }).pipe(
              Effect.map((output) => toolResult(output, input.description)), // kilocode_change
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to execute command: ${input.command}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(ShellSelect.name(yield* compatibleShell))
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
