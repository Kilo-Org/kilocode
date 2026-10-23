import { KiloCustomRouter } from "@kilocode/gateway-core"
import { Runtime } from "@opencode/cli/framework/runtime"
import { OPENCODE_VERSION } from "@opencode/cli/version"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Effect, Option, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { AutoCommand } from "./auto"
import {
  EVAL_ENTRYPOINT,
  EVAL_ENTRYPOINT_FILE,
  evalCliArgs,
  evalCliVersion,
  evalDockerfile,
  evalDockerRunArgs,
  evalImageTag,
  type EvalContainerResult,
} from "./eval-docker"
import { parseKiloRunEvents } from "./eval-events"
import { CallError, call, connect, decode, print, reference, report, UsageError } from "./shared"

// `kilo auto eval`: port of v1 packages/opencode/src/kilocode/auto-routing/eval.ts (#15183). Runs the missing client
// evals of a custom router, one fresh container per case, and uploads each result at once. The server resolves the
// Kilo account, the entry model's config and its credential (`routers.evalConfig`).

// Balance and benchmark limits apply to the owner, not the case: every later upload would fail the same way after
// spending local inference on it.
const STOP_CODES = new Set(["insufficient_balance", "quota_exceeded"])

type Connection = Effect.Success<ReturnType<typeof connect>>

export default Runtime.handler(
  AutoCommand.commands.eval,
  Effect.fn("kilo.auto.eval")(function* (input) {
    if (input.concurrency < 1) return yield* Effect.fail(new UsageError("--concurrency must be at least 1"))
    const target = yield* reference(input.router)
    const cli = evalCliVersion({ flag: Option.getOrUndefined(input.cliVersion), installed: OPENCODE_VERSION })
    if (!cli.ok) return yield* Effect.fail(new UsageError(cli.message))
    const connection = yield* connect(input)
    const list = yield* decode(
      KiloCustomRouter.ListResponse,
      yield* call(() => connection.rpc["routers.list"]({}, connection.options)).pipe(
        Effect.mapError((error) => new CallError(`Could not load the router list: ${error.message}`, error.code)),
      ),
    )
    const router = list.routers.find((item) => item.modelId === target.modelID)
    if (!router)
      return yield* Effect.fail(
        new UsageError(
          `Custom auto router ${target.modelID} was not found. Check the id with \`kilo auto router list\`.`,
        ),
      )
    if ((yield* exec(["docker", "version", "--format", "{{.Server.Version}}"], { timeout: 30_000 })).code !== 0)
      return yield* Effect.fail(
        new UsageError(
          "Docker is required for client evals and the Docker daemon is not reachable. Start Docker and try again.",
        ),
      )

    const image = evalImageTag(cli.version)
    if ((yield* exec(["docker", "image", "inspect", image], { timeout: 30_000 })).code !== 0) {
      yield* print(`Building the eval image ${image} (node:22-slim + @kilocode/cli@${cli.version})...`)
      yield* buildImage(image, cli.version)
    }

    const plan = yield* decode(
      KiloCustomRouter.EvalPlan,
      yield* call(() => connection.rpc["routers.evalPlan"]({ routerID: router.id }, connection.options)).pipe(
        Effect.mapError((error) => new CallError(`Could not load the eval plan: ${error.message}`, error.code)),
      ),
    )
    if (plan.items.length === 0)
      return yield* print(`Nothing to evaluate for ${router.modelId}: every entry has a current result.`)

    const cases = new Map<string, KiloCustomRouter.EvalCase>()
    if (input.debugConfig) {
      const first = plan.items[0]!
      const resolved = yield* resolveCase(connection, router, first, cases)
      yield* print("kilo auto eval would run:")
      return yield* print(
        KiloCustomRouter.redacted({
          image,
          args: evalDockerRunArgs({
            image,
            envFile: "<env-file>",
            args: evalCliArgs({
              provider: resolved.config.provider,
              model: resolved.config.model,
              variant: first.variant,
            }),
          }),
          config: resolved.config.config,
        }),
      )
    }

    yield* print(`Eval plan for ${router.modelId}: ${plan.items.length} case(s), engine ${plan.engineIdentity}.`)
    for (const stale of plan.staleEntries)
      yield* print(
        `  stale: ${label(stale.entry)} variant ${stale.variant ?? "default"} (serving an older measurement)`,
      )
    if (!input.yes && !(yield* confirm(input.router))) return yield* print("Cancelled.")

    const queue = [...plan.items]
    const stats = { uploaded: 0, failed: 0 }
    const worker = Effect.gen(function* () {
      while (true) {
        const item = queue.shift()
        if (!item) return
        yield* runItem(connection, router, plan, item, cases, image).pipe(
          Effect.tap(() => Effect.sync(() => stats.uploaded++)),
          Effect.catch((error) =>
            Effect.gen(function* () {
              stats.failed++
              process.stderr.write(`case ${item.caseId} rep ${item.rep}: ${error.message}${os.EOL}`)
              if (error instanceof CallError && error.code && STOP_CODES.has(error.code)) {
                stats.failed += queue.length
                queue.length = 0
              }
            }),
          ),
        )
      }
    })
    yield* Effect.all(
      Array.from({ length: input.concurrency }, () => worker),
      { concurrency: "unbounded" },
    )
    if (stats.failed > 0)
      return yield* Effect.fail(
        new UsageError(`${stats.uploaded} case(s) uploaded, ${stats.failed} failed. Re-run to resume.`),
      )
    yield* print(`${stats.uploaded} case(s) uploaded and graded.`)
  }, Effect.catch(report())),
)

function runItem(
  connection: Connection,
  router: KiloCustomRouter.Summary,
  plan: KiloCustomRouter.EvalPlan,
  item: KiloCustomRouter.EvalPlanItem,
  cases: Map<string, KiloCustomRouter.EvalCase>,
  image: string,
) {
  return Effect.gen(function* () {
    const resolved = yield* resolveCase(connection, router, item, cases)
    const env = yield* Effect.promise(() =>
      writeEnvFile({
        KILO_CONFIG_CONTENT: JSON.stringify(resolved.config.config),
        KILO_AUTH_CONTENT: JSON.stringify(resolved.config.auth),
        KILO_DISABLE_SESSION_INGEST: "1",
        KILO_API_URL: resolved.config.server,
        ...(process.env.KILO_AI_GATEWAY_URL ? { KILO_AI_GATEWAY_URL: process.env.KILO_AI_GATEWAY_URL } : {}),
        ...(resolved.config.organizationID ? { KILO_ORG_ID: resolved.config.organizationID } : {}),
        EVAL_TIMEOUT_MS: String(resolved.case.timeoutMs),
        NO_COLOR: "1",
      }),
    )
    return yield* Effect.gen(function* () {
      const prompt = path.join(env.dir, "prompt.txt")
      yield* Effect.promise(() => fs.writeFile(prompt, resolved.case.prompt, { mode: 0o600 }))
      const args = evalCliArgs({
        provider: resolved.config.provider,
        model: resolved.config.model,
        variant: item.variant,
      })
      // The case prompt goes on stdin: a long prompt exceeds the argument size limit.
      const result = yield* exec(["docker", ...evalDockerRunArgs({ image, envFile: env.file, args })], {
        stdin: Bun.file(prompt),
        timeout: resolved.case.timeoutMs + 120_000,
      })
      const parsed = yield* containerResult(result.stdout)
      if (parsed.stdoutTruncated)
        return yield* Effect.fail(new CallError("Output exceeded the container stdout cap; the case was not uploaded"))
      const events = parseKiloRunEvents(parsed.stdoutLines)
      const score = yield* decode(
        KiloCustomRouter.EvalResult,
        yield* call(() =>
          connection.rpc["routers.evalResult"](
            {
              result: {
                routerId: router.id,
                engineIdentity: plan.engineIdentity,
                entry: item.entry,
                variant: item.variant,
                caseId: item.caseId,
                rep: item.rep,
                output: events.text,
                costUsd: events.costUsd ?? 0,
                durationMs: parsed.durationMs,
                exitCode: parsed.exitCode,
                timedOut: parsed.timedOut,
              },
            },
            connection.options,
          ),
        ),
      )
      yield* print(
        `case ${item.caseId} rep ${item.rep} ${label(item.entry)} variant ${item.variant ?? "default"}: score ${score.score.toFixed(3)}`,
      )
    }).pipe(Effect.ensuring(Effect.promise(() => fs.rm(env.dir, { recursive: true, force: true }))))
  })
}

function resolveCase(
  connection: Connection,
  router: KiloCustomRouter.Summary,
  item: KiloCustomRouter.EvalPlanItem,
  cases: Map<string, KiloCustomRouter.EvalCase>,
) {
  return Effect.gen(function* () {
    const cached = cases.get(item.caseId)
    const benchCase =
      cached ??
      (yield* decode(
        KiloCustomRouter.EvalCase,
        yield* call(() =>
          connection.rpc["routers.evalCase"]({ routerID: router.id, caseID: item.caseId }, connection.options),
        ),
      ))
    cases.set(item.caseId, benchCase)
    const config = yield* call(() => connection.rpc["routers.evalConfig"]({ entry: item.entry }, connection.options))
    return { case: benchCase, config: config as KiloGatewayRpc.RouterEvalConfig }
  })
}

function label(entry: KiloCustomRouter.EntryRef) {
  return entry.kind === "gateway" ? entry.model : `client:${entry.provider}/${entry.model}`
}

function exec(cmd: string[], options: { readonly stdin?: Bun.BunFile; readonly timeout: number }) {
  return Effect.promise(async () => {
    const proc = Bun.spawn(cmd, {
      stdin: options.stdin ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeout,
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stdout, stderr }
  }).pipe(Effect.catchDefect(() => Effect.succeed({ code: -1, stdout: "", stderr: "" })))
}

function buildImage(image: string, version: string) {
  return Effect.acquireUseRelease(
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-auto-eval-"))),
    (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "Dockerfile"), evalDockerfile(version)))
        yield* Effect.promise(() => fs.writeFile(path.join(dir, EVAL_ENTRYPOINT_FILE), EVAL_ENTRYPOINT))
        const result = yield* exec(["docker", "build", "-t", image, dir], { timeout: 900_000 })
        if (result.code !== 0) return yield* Effect.fail(new CallError(`docker build failed: ${result.stderr.trim()}`))
      }),
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  )
}

function confirm(router: string) {
  return Effect.promise(async () => {
    const readline = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await readline.question(`Run these evals for ${router}? [y/N] `).finally(() => readline.close())
    return /^y(es)?$/i.test(answer.trim())
  })
}

async function writeEnvFile(values: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-auto-eval-env-"))
  const file = path.join(dir, "eval.env")
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
  // The caller owns cleanup only after this returns; a failed write must not leave credentials behind.
  await fs.writeFile(file, body, { mode: 0o600 }).catch(async (error: unknown) => {
    await fs.rm(dir, { recursive: true, force: true })
    throw error
  })
  return { dir, file }
}

const ContainerResult = Schema.fromJsonString(
  Schema.Struct({
    exitCode: Schema.Number,
    durationMs: Schema.Number,
    timedOut: Schema.Boolean,
    stdoutTruncated: Schema.Boolean,
    stdoutLines: Schema.Array(Schema.String),
    stderrTail: Schema.String,
  }),
)

function containerResult(stdout: string): Effect.Effect<EvalContainerResult, CallError> {
  const start = stdout.indexOf("{")
  if (start === -1) return Effect.fail(new CallError(`Container produced no result: ${stdout.slice(0, 200)}`))
  return Schema.decodeUnknownEffect(ContainerResult)(stdout.slice(start)).pipe(
    Effect.map((result) => ({ ...result, stdoutLines: [...result.stdoutLines] })),
    Effect.mapError(() => new CallError(`Container produced no result: ${stdout.slice(0, 200)}`)),
  )
}
