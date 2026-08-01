// kilocode_change - new file
import { Effect, Schema } from "effect"
import * as path from "path"
import { pathToFileURL } from "node:url"
import { Tool } from "../../tool/tool"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "../../tool/external-directory"
import { DaemonClient } from "@kilocode/world/client"
import type { ActionResult, RunResult } from "@kilocode/world/types"
import * as Log from "@opencode-ai/core/util/log"
import { inspect } from "./world-script"
import type { WorldConfig } from "@kilocode/world/types"
import { resolve } from "./world-config"

const log = Log.create({ service: "kilocode-tool-world" })
const MAX_TIMEOUT = 10 * 60_000
const MAX_INLINE_BYTES = 1_000_000
const MAX_SCREENSHOTS = 20
const MAX_FILES = 200
const MAX_AGE = 7 * 24 * 60 * 60_000

const DESCRIPTION = `Drive a Chromium browser to render pages, run JavaScript, click through UI, and capture screenshots. State persists across calls in a per-session daemon.

Proactively use this to verify UI changes (component, layout, style) without being asked by navigating to the page and confirming the result.

Scripts are ;-separated verb calls. Prefer CSS selectors (\`#foo\`, \`input#bar\`) over role selectors — they pierce shadow DOM and survive across snapshots.

Verb grammar:
  Common: \`--ref <eN>\` from snapshot (preferred) or \`--selector <css>\`. Values with spaces or \`;\` need quotes.
  status - capability, sessions, Chromium installation state
  navigate --url <url> [--wait <sel>] [--timeout <ms>]
  snapshot - DOM walk with stable [ref=eN] ids and CSS selectors; prefer over screenshot
  click | type --text | fill --value [--force] | hover | scroll --dx N --dy N - each takes --ref or --selector
  press-key --chord "<spec>" (e.g. "Control+a")
  drag --from <ref|sel> --to <ref|sel>
  wait-for --selector | --text | --url [--timeout <ms>]
  screenshot --out <file> [--full] [--wait <ms>] [--type png|jpeg] [--quality 50-100]
  evaluate --js <code> | --js-file <path>
  tabs list | open --url | select --index | close
  cookies get --domain D | set --name N --value V --domain D | clear [--domain D]
  shutdown - close browser; daemon stays alive
  daemon.start --idle <ms> | daemon.status | daemon.stop

Example:
  world({ script: "navigate --url http://localhost:3000/settings ; snapshot ; screenshot --out /tmp/check.png" })
`

const Params = Schema.Struct({
  script: Schema.String.annotate({
    description: "A ;-separated sequence of browser actions. Example: `navigate --url https://example.com ; snapshot`.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Overall timeout in milliseconds. Defaults to 60_000 and is capped at 600_000.",
  }),
})
export type Params = Schema.Schema.Type<typeof Params>

type Meta = {
  title: string
  ok: boolean
  durationMs: number
  actions: number
  failedAt?: number
  daemonStarted?: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function summarize(r: ActionResult): string {
  if (!r.ok) return ` → error: ${r.error ?? "unknown"} (${r.durationMs}ms)`
  const data = record(r.data) ? r.data : undefined
  if (!data) return ` → ok (${r.durationMs}ms)`
  if (r.verb === "navigate") {
    const u = typeof data["finalUrl"] === "string" ? data["finalUrl"] : ""
    return ` → ${u} (${r.durationMs}ms)`
  }
  if (r.verb === "snapshot") {
    return ` → ${renderRefList(r.refs, 8)}`
  }
  if (r.verb === "screenshot") {
    return ` → ${r.screenshot?.bytes ?? 0} bytes (${r.durationMs}ms)`
  }
  if (r.verb === "evaluate") {
    return ` → ${JSON.stringify(data["result"])} (${r.durationMs}ms)`
  }
  return ` → ${JSON.stringify(data).slice(0, 200)} (${r.durationMs}ms)`
}

function title(result: RunResult, failed?: ActionResult): string {
  if (failed) return `world ${failed.verb} failed`
  if (result.results.length === 1) return `world ${result.results[0].verb}`
  return `world ${result.results.length} actions`
}

function renderRefList(
  refs: Array<{ ref: string; role: string; name: string; selector?: string }> | undefined,
  limit: number,
): string {
  if (!refs || refs.length === 0) return "0 refs"
  const lines: string[] = [`${refs.length} refs:`]
  for (const r of refs.slice(0, limit)) {
    const name = (r.name ?? "").slice(0, 60).replace(/\s+/g, " ").trim()
    const sel = r.selector ?? ""
    lines.push(`  ${r.ref} [${r.role}] sel=${sel}${name ? ` name=${JSON.stringify(name)}` : ""}`)
  }
  if (refs.length > limit) lines.push(`  … (${refs.length - limit} more)`)
  return lines.join("\n")
}

async function attachmentForResult(
  r: ActionResult,
  directory: string,
): Promise<{ type: "file"; mime: string; url: string; filename: string } | undefined> {
  if (!r.screenshot) return undefined
  const abs = path.isAbsolute(r.screenshot.path) ? r.screenshot.path : path.join(directory, r.screenshot.path)
  const mime = r.screenshot.mime ?? "image/png"
  const data = await readInlineData(abs, mime)
  if (data) return { type: "file", mime, url: data, filename: path.basename(abs) }
  return { type: "file", mime, url: pathToFileURL(abs).href, filename: path.basename(abs) }
}

async function formatResult(
  result: RunResult,
  directory: string,
): Promise<{
  output: string
  attachments: Array<{ type: "file"; mime: string; url: string; filename: string }>
}> {
  const lines: string[] = []
  for (const [i, r] of result.results.entries()) {
    const summary = summarize(r)
    lines.push(`[${i + 1}/${result.results.length}] ${r.verb}${summary.includes("\n") ? "\n" + summary : summary}`)
  }
  const shot = result.results.findLast((item) => item.screenshot)
  const att = shot ? await attachmentForResult(shot, directory) : undefined
  const attachments = att ? [att] : []
  return { output: lines.join("\n"), attachments }
}

async function readInlineData(abs: string, mime: string = "image/png"): Promise<string | null> {
  try {
    const file = Bun.file(abs)
    if (!(await file.exists()) || file.size > MAX_INLINE_BYTES) return null
    const buf = await file.bytes()
    return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`
  } catch {
    return null
  }
}

async function prune(dir: string, prefix: string): Promise<void> {
  const files: Array<{ path: string; modified: number }> = []
  try {
    for await (const file of new Bun.Glob("*.jpg").scan({ cwd: dir, absolute: true })) {
      files.push({ path: file, modified: Bun.file(file).lastModified })
    }
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return
    throw err
  }
  files.sort((a, b) => b.modified - a.modified)
  const now = Date.now()
  const session = files.filter((item) => path.basename(item.path).startsWith(prefix))
  const remove = new Set([
    ...files.filter((item) => now - item.modified > MAX_AGE).map((item) => item.path),
    ...files.slice(MAX_FILES - 1).map((item) => item.path),
    ...session.slice(MAX_SCREENSHOTS - 1).map((item) => item.path),
  ])
  await Promise.all(
    [...remove].map((file) =>
      Bun.file(file)
        .delete()
        .catch((err) => {
          if (err instanceof Error && "code" in err && err.code === "ENOENT") return
          throw err
        }),
    ),
  )
}

function screenshotPath(config: WorldConfig, session: string, call: string | undefined): string {
  const name = `${prefix(session)}${call ?? Date.now()}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
  return path.join(config.home, "screenshots", `${name}.jpg`)
}

function prefix(session: string): string {
  return `${session.replace(/[^a-zA-Z0-9_.-]/g, "_")}-`
}

export const WorldTool = Tool.define(
  "world",
  Effect.gen(function* () {
    const configs = yield* Config.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const inst = yield* InstanceState.context
          const config = resolve(yield* configs.get(), yield* configs.getGlobal())
          const script = inspect(params.script, inst.directory)

          yield* ctx.ask({
            permission: "world",
            patterns: ["browser"],
            always: ["browser"],
            metadata: { script: params.script },
          })
          if (script.evaluates) {
            yield* ctx.ask({
              permission: "world",
              patterns: ["evaluate"],
              always: ["evaluate"],
              metadata: { script: params.script },
            })
          }
          for (const url of script.urls) {
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
              throw new Error(`URL must start with http:// or https://: ${url}`)
            }
            yield* ctx.ask({
              permission: "webfetch",
              patterns: [url],
              always: ["*"],
              metadata: { script: params.script },
            })
          }
          for (const file of script.reads) {
            yield* assertExternalDirectoryEffect(ctx, file)
            yield* ctx.ask({
              permission: "read",
              patterns: [path.relative(inst.worktree, file)],
              always: ["*"],
              metadata: { filepath: file },
            })
          }
          for (const file of script.writes) {
            yield* assertExternalDirectoryEffect(ctx, file)
            yield* ctx.ask({
              permission: "edit",
              patterns: [path.relative(inst.worktree, file)],
              always: ["*"],
              metadata: { filepath: file },
            })
          }

          const wasRunning = DaemonClient.isRunning(ctx.sessionID)
          const requested = params.timeout ?? 60_000
          if (!Number.isFinite(requested) || requested <= 0) throw new Error("timeout must be a positive finite number")
          const timeout = Math.min(requested, MAX_TIMEOUT)
          const controller = new AbortController()
          const onAbort = () => controller.abort()
          ctx.abort.addEventListener("abort", onAbort, { once: true })
          if (ctx.abort.aborted) controller.abort()
          const timer = setTimeout(() => controller.abort(), timeout)
          const run = yield* Effect.promise(() =>
            DaemonClient.runViaSession(ctx.sessionID, params.script, {
              signal: controller.signal,
              timeoutMs: timeout,
              directory: inst.directory,
              paths: [...script.reads, ...script.writes],
              config,
            }).finally(() => {
              clearTimeout(timer)
              ctx.abort.removeEventListener("abort", onAbort)
            }),
          )

          const failedIdx = run.results.findIndex((r) => !r.ok)
          const failed = failedIdx >= 0 ? run.results[failedIdx] : undefined
          const name = title(run, failed)
          const meta: Meta = {
            title: name,
            ok: run.ok,
            durationMs: run.durationMs,
            actions: run.results.length,
            daemonStarted: !wasRunning,
            ...(failedIdx >= 0 ? { failedAt: failedIdx } : {}),
          }

          const formatted = yield* Effect.promise(() => formatResult(run, inst.directory))

          const lastResult = run.results[run.results.length - 1]
          const visual =
            lastResult &&
            !["status", "close", "shutdown", "daemon.start", "daemon.status", "daemon.stop"].includes(lastResult.verb)
          if (run.ok && visual && !lastResult.screenshot) {
            const out = screenshotPath(config, ctx.sessionID, ctx.callID)
            const auto = yield* Effect.promise(async () => {
              await prune(path.dirname(out), prefix(ctx.sessionID))
              return DaemonClient.runViaSession(
                ctx.sessionID,
                `screenshot --out ${JSON.stringify(out)} --type jpeg --quality 80`,
                {
                  signal: ctx.abort,
                  timeoutMs: 15_000,
                  directory: inst.directory,
                  paths: [out],
                  config,
                },
              )
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => {
                  log.warn("auto-screenshot failed", { cause: String(cause) })
                  return undefined
                }),
              ),
            )
            if (auto) {
              const shot = auto.results[0]
              if (shot?.screenshot) {
                const att = yield* Effect.promise(() => attachmentForResult(shot, inst.directory))
                if (att) {
                  formatted.attachments.splice(0, formatted.attachments.length, att)
                  formatted.output += `\n[auto-screenshot] ${shot.screenshot.bytes} bytes`
                }
              }
            }
          }

          return {
            title: name,
            output: run.ok
              ? formatted.output
              : `${formatted.output}\n\nScript failed at action ${failedIdx + 1}: ${failed?.error ?? "unknown"}`,
            metadata: meta,
            ...(formatted.attachments.length > 0 ? { attachments: formatted.attachments } : {}),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
