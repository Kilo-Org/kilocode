import fs from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { UI } from "@/cli/ui"
import { Process } from "@/util/process"
import { errorMessage } from "@/util/error"
import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import {
  fetchClientEvalCase,
  fetchClientEvalPlan,
  fetchCustomRouters,
  KILO_API_BASE,
  parseCustomRouterModelId,
  uploadClientEvalResult,
  CustomRouterRequestError,
  type ClientEvalCaseResponse,
  type ClientEvalPlanItem,
  type CustomRouterEntryRef,
  type CustomRouterSummary,
} from "@kilocode/kilo-gateway"
import { parseKiloRunEvents } from "./eval-events"
import { KiloCustomRouter } from "./router"
import {
  EVAL_ENTRYPOINT,
  EVAL_ENTRYPOINT_FILE,
  evalCliArgs,
  evalCliVersion,
  evalDockerfile,
  evalDockerRunArgs,
  evalImageTag,
  evalProviderConfig,
  redactedConfig,
  type EvalContainerResult,
} from "./eval-docker"

export type EvalInput = {
  router: string
  yes: boolean
  concurrency: number
  debugConfig: boolean
  token: string
  organizationId?: string | null
  providers: Record<ProviderV2.ID, Provider.Info>
  auth: Record<string, Auth.Info>
  cliVersion?: string
}

type Run = { fail: (message: string) => void; ok: (message: string) => void }

export namespace KiloAutoEval {
  export async function run(input: EvalInput, io: Run = report()): Promise<number> {
    const parsed = parseRouter(input.router)
    if (!parsed) {
      io.fail(`Not a custom router: "${input.router}". Use \`kilo-auto/custom/<slug>\` or a slug.`)
      return 1
    }
    const cli = evalCliVersion({ flag: input.cliVersion, installed: InstallationVersion })
    if (!cli.ok) {
      io.fail(cli.message)
      return 1
    }
    const list = await fetchCustomRouters({
      token: input.token,
      organizationId: input.organizationId,
    }).catch((error) => {
      throw wrap(error, "Could not load the router list")
    })
    const router = list.routers.find((item) => item.modelId === parsed)
    if (!router) {
      io.fail(`Custom auto router ${parsed} was not found. Check the id with \`kilo auto router list\`.`)
      return 1
    }
    if (!(await docker("version", "--format", "{{.Server.Version}}"))) {
      io.fail("Docker is required for client evals and the Docker daemon is not reachable. Start Docker and try again.")
      return 1
    }

    const version = cli.version
    const image = evalImageTag(version)
    if (!(await docker("image", "inspect", image))) {
      UI.println(`Building the eval image ${image} (node:22-slim + @kilocode/cli@${version})...`)
      await buildImage(image, version)
    }

    const plan = await fetchClientEvalPlan({
      token: input.token,
      organizationId: input.organizationId,
      routerId: router.id,
    }).catch((error) => {
      throw wrap(error, "Could not load the eval plan")
    })
    if (plan.items.length === 0) {
      io.ok(`Nothing to evaluate for ${router.modelId}: every entry has a current result.`)
      return 0
    }

    const cases = new Map<string, ClientEvalCaseResponse>()
    if (input.debugConfig) {
      const first = plan.items[0]!
      const item = await resolveCase({ input, router, item: first, cases })
      UI.println("kilo auto eval would run:")
      UI.println(
        redactedConfig({
          image,
          args: evalDockerRunArgs({
            image,
            envFile: "<env-file>",
            args: evalCliArgs({
              provider: item.provider,
              model: item.model,
              variant: first.variant,
            }),
          }),
          config: item.config,
        }),
      )
      return 0
    }

    UI.println(`Eval plan for ${router.modelId}: ${plan.items.length} case(s), engine ${plan.engineIdentity}.`)
    for (const stale of plan.staleEntries) {
      UI.println(`  stale: ${label(stale.entry)} variant ${stale.variant ?? "default"} (serving an older measurement)`)
    }
    if (!input.yes && !(await confirm(input.router))) {
      UI.println("Cancelled.")
      return 0
    }

    const queue = [...plan.items]
    const stats = { uploaded: 0, failed: 0 }
    const workers = Array.from({ length: Math.max(1, input.concurrency) }, () =>
      worker({ input, router, plan, queue, cases, stats, image, io }),
    )
    await Promise.all(workers)
    if (stats.failed > 0) {
      io.fail(`${stats.uploaded} case(s) uploaded, ${stats.failed} failed. Re-run to resume.`)
      return 1
    }
    io.ok(`${stats.uploaded} case(s) uploaded and graded.`)
    return 0
  }
}

function report(): Run {
  return { fail: UI.error, ok: UI.println }
}

function wrap(error: unknown, prefix: string): Error {
  return new Error(`${prefix}: ${describe(error)}`)
}

function describe(error: unknown): string {
  return error instanceof CustomRouterRequestError ? KiloCustomRouter.failure(error).message : errorMessage(error)
}

// Balance and benchmark limits apply to the owner, not the case: every later
// upload would fail the same way after spending local inference on it.
const STOP_CODES: Record<string, true> = { insufficient_balance: true, quota_exceeded: true }

// Accepts the full model id or a bare slug, with an optional org prefix.
function parseRouter(value: string): string | undefined {
  const full = parseCustomRouterModelId(value)
  if (full) return value
  const org = value.startsWith("org/") ? value.slice("org/".length) : undefined
  const candidate = org ? `kilo-auto/custom/org/${org}` : `kilo-auto/custom/${value}`
  return parseCustomRouterModelId(candidate) ? candidate : undefined
}

async function docker(...args: string[]): Promise<boolean> {
  const result = await Process.text(["docker", ...args], { nothrow: true, timeout: 30_000 })
  return result.code === 0
}

async function buildImage(image: string, version: string): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-auto-eval-"))
  try {
    await fs.writeFile(path.join(dir, "Dockerfile"), evalDockerfile(version))
    await fs.writeFile(path.join(dir, EVAL_ENTRYPOINT_FILE), EVAL_ENTRYPOINT)
    const result = await Process.text(["docker", "build", "-t", image, dir], { nothrow: true, timeout: 900_000 })
    if (result.code !== 0) throw new Error(`docker build failed: ${result.stderr.toString().trim()}`)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

async function confirm(router: string): Promise<boolean> {
  const answer = await UI.input(`Run these evals for ${router}? [y/N] `)
  return /^y(es)?$/i.test(answer.trim())
}

type Worker = {
  input: EvalInput
  router: CustomRouterSummary
  plan: { engineIdentity: string }
  queue: ClientEvalPlanItem[]
  cases: Map<string, ClientEvalCaseResponse>
  stats: { uploaded: number; failed: number }
  image: string
  io: Run
}

async function worker(state: Worker): Promise<void> {
  for (;;) {
    const item = state.queue.shift()
    if (!item) return
    try {
      await runItem(state, item)
      state.stats.uploaded += 1
    } catch (error) {
      state.stats.failed += 1
      state.io.fail(`case ${item.caseId} rep ${item.rep}: ${describe(error)}`)
      if (error instanceof CustomRouterRequestError && STOP_CODES[error.code]) {
        state.stats.failed += state.queue.length
        state.queue.length = 0
      }
    }
  }
}

async function runItem(state: Worker, item: ClientEvalPlanItem): Promise<void> {
  const resolved = await resolveCase({ input: state.input, router: state.router, item, cases: state.cases })
  const env = await writeEnvFile({
    KILO_CONFIG_CONTENT: JSON.stringify(resolved.config),
    KILO_AUTH_CONTENT: JSON.stringify(resolved.auth),
    KILO_DISABLE_SESSION_INGEST: "1",
    KILO_API_URL: KILO_API_BASE,
    ...(process.env.KILO_AI_GATEWAY_URL ? { KILO_AI_GATEWAY_URL: process.env.KILO_AI_GATEWAY_URL } : {}),
    ...(state.input.organizationId ? { KILO_ORG_ID: state.input.organizationId } : {}),
    EVAL_TIMEOUT_MS: String(resolved.case.timeoutMs),
    NO_COLOR: "1",
  })
  let prompt: FileHandle | undefined
  try {
    const promptFile = path.join(env.dir, "prompt.txt")
    await fs.writeFile(promptFile, resolved.case.prompt, { mode: 0o600 })
    prompt = await fs.open(promptFile, "r")
    const args = evalCliArgs({
      provider: resolved.provider,
      model: resolved.model,
      variant: item.variant,
    })
    const result = await Process.text(
      ["docker", ...evalDockerRunArgs({ image: state.image, envFile: env.file, args })],
      {
        nothrow: true,
        stdin: prompt.fd,
        timeout: resolved.case.timeoutMs + 120_000,
      },
    )
    const parsed = containerResult(result.stdout.toString())
    if (parsed.stdoutTruncated) throw new Error("Output exceeded the container stdout cap; the case was not uploaded")
    const events = parseKiloRunEvents(parsed.stdoutLines)
    const score = await uploadClientEvalResult({
      token: state.input.token,
      organizationId: state.input.organizationId,
      body: {
        routerId: state.router.id,
        engineIdentity: state.plan.engineIdentity,
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
    })
    state.io.ok(
      `case ${item.caseId} rep ${item.rep} ${label(item.entry)} variant ${item.variant ?? "default"}: score ${score.score.toFixed(3)}`,
    )
  } finally {
    await prompt?.close()
    await fs.rm(env.dir, { recursive: true, force: true })
  }
}

function label(entry: CustomRouterEntryRef): string {
  return entry.kind === "gateway" ? entry.model : `client:${entry.provider}/${entry.model}`
}

async function writeEnvFile(values: Record<string, string>): Promise<{ dir: string; file: string }> {
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

function containerResult(stdout: string): EvalContainerResult {
  const start = stdout.indexOf("{")
  if (start === -1) throw new Error(`Container produced no result: ${stdout.slice(0, 200)}`)
  return JSON.parse(stdout.slice(start)) as EvalContainerResult
}

async function resolveCase(input: {
  input: EvalInput
  router: CustomRouterSummary
  item: ClientEvalPlanItem
  cases: Map<string, ClientEvalCaseResponse>
}) {
  const cached = input.cases.get(input.item.caseId)
  const benchCase =
    cached ??
    (await fetchClientEvalCase({
      token: input.input.token,
      organizationId: input.input.organizationId,
      routerId: input.router.id,
      caseId: input.item.caseId,
    }))
  input.cases.set(input.item.caseId, benchCase)

  if (input.item.entry.kind === "client") {
    const provider = input.input.providers[ProviderV2.ID.make(input.item.entry.provider)]
    const model = provider?.models[input.item.entry.model]
    if (!provider || !model) {
      throw new Error(`Client model ${input.item.entry.provider}/${input.item.entry.model} is not configured locally`)
    }
    return {
      case: benchCase,
      provider: input.item.entry.provider,
      model: input.item.entry.model,
      config: evalProviderConfig({ model, provider }),
      auth: containerAuth({
        auth: input.input.auth,
        providerID: input.item.entry.provider,
        provider,
        kilo: kiloAuth(input.input),
      }),
    }
  }

  return {
    case: benchCase,
    provider: "kilo",
    model: input.item.entry.model,
    config: {
      provider: { kilo: { options: {} } },
      enabled_providers: ["kilo"],
    },
    auth: { kilo: kiloAuth(input.input) },
  }
}

function kiloAuth(input: EvalInput): Record<string, unknown> {
  const entry = input.auth[ProviderV2.ID.kilo]
  if (entry && entry.type !== "wellknown") {
    return { ...entry, ...(input.organizationId ? { organizationId: input.organizationId } : {}) }
  }
  return {
    type: "api",
    key: entry?.key ?? "",
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
  }
}

// The container gets only the credential of the provider it runs. Keys resolved
// from the environment or config are converted to an api entry so the child CLI
// never needs the host environment. Values are written to a 0600 env file and
// never printed.
function containerAuth(input: {
  auth: Record<string, Auth.Info>
  providerID: string
  provider: Provider.Info
  kilo: Record<string, unknown>
}): Record<string, unknown> {
  const stored = input.auth[input.providerID]
  if (stored) return { [input.providerID]: stored, kilo: input.kilo }
  const options = input.provider.options as Record<string, unknown>
  const key = input.provider.key ?? (typeof options.apiKey === "string" ? options.apiKey : undefined)
  if (!key) return { kilo: input.kilo }
  return { [input.providerID]: { type: "api", key }, kilo: input.kilo }
}
