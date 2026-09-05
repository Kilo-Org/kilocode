import { Effect, Fiber, Stream, Option } from "effect" // kilocode_change - Fiber, Option (ActionJudge)
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { FSUtil } from "@opencode-ai/core/fs-util"
import { fileURLToPath } from "url"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { model as modelEnv } from "@/kilocode/process/env" // kilocode_change
import { Shell } from "@opencode-ai/core/shell"
import { ShellID } from "./shell/id"

import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { normalizeUrls } from "@/kilocode/util/url" // kilocode_change
import { CommandTimeout } from "@/kilocode/command-timeout" // kilocode_change
import { heredocs } from "@/kilocode/tool/shell-heredoc" // kilocode_change
import { unparsed } from "@/kilocode/tool/shell-unparsed" // kilocode_change
import * as ActionGate from "@/kilocode/gate/action-gate" // kilocode_change
import * as ActionJudge from "@/kilocode/gate/action-judge" // kilocode_change - reasoning-blind classifier (stage 2)
import { ACTION_GATE_DEGRADED_KEY, ACTION_GATE_REASON_KEY } from "@/kilocode/permission/interactive-approval" // kilocode_change - degraded escalation metadata
import { Provider } from "@/provider/provider" // kilocode_change - ActionJudge model access (via serviceOption)
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ShellPrompt, type Parameters } from "./shell/prompt"
import { BashArity } from "@/permission/arity"
import { mutates as mutatesGit } from "@/kilocode/sandbox/git" // kilocode_change
import * as SandboxPolicy from "@/kilocode/sandbox/policy" // kilocode_change

export { Parameters } from "./shell/prompt"

const MAX_METADATA_LENGTH = 30_000
const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
// kilocode_change start
const READ = new Set(["cat", "get-content"])
// kilocode_change end
const CMD_FILES = new Set([
  "copy",
  "del",
  "dir",
  "erase",
  "md",
  "mkdir",
  "move",
  "rd",
  "ren",
  "rename",
  "rmdir",
  "type",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

type Part = {
  type: string
  text: string
}

// kilocode_change start
type Access = "read" | "unknown"
// kilocode_change end

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
  access: Access // kilocode_change
}

type Chunk = {
  text: string
  size: number
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function parts(node: Node) {
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

// kilocode_change start
function access(cmd: string, node: Node): Access {
  if (!READ.has(cmd)) return "unknown"
  if (node.parent?.type === "redirected_statement") return "unknown"
  return "read"
}
// kilocode_change end

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean, cmd = false) {
  if (!ps) {
    return list
      .slice(1)
      .filter(
        (item) =>
          !item.text.startsWith("-") &&
          !(cmd && item.text.startsWith("/")) &&
          !(list[0]?.text === "chmod" && item.text.startsWith("+")),
      )
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
  }

  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const parse = Effect.fn("ShellTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree
})

export const ask = Effect.fn("ShellTool.ask")(function* (
  ctx: Tool.Context,
  scan: Scan,
  command: string,
  metadata: ReturnType<typeof heredocs>, // kilocode_change
  description?: string, // kilocode_change
  degraded?: ActionJudge.AskCode, // kilocode_change - classifier-failure escalation: tag this real bash ask
) {
  // kilocode_change
  if (scan.dirs.size > 0) {
    const directories = Array.from(scan.dirs)
    const globs = directories.map((dir) => {
      if (process.platform === "win32") return FSUtil.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      // kilocode_change start - retain read classification alongside upstream permission context
      metadata: {
        command,
        ...(description ? { description } : {}),
        directories,
        patterns: globs,
        ...(scan.access === "read" ? { access: "read" as const } : {}),
        ...metadata,
      },
      // kilocode_change end
    })
  }

  // kilocode_change - degraded escalation reuses THIS real bash ask; force a prompt even with empty patterns.
  const shellPatterns = scan.patterns.size === 0 ? (degraded ? [command] : []) : Array.from(scan.patterns)
  if (shellPatterns.length === 0) return
  yield* ctx.ask({
    permission: ShellID.ToolID,
    patterns: shellPatterns,
    always: degraded ? [] : Array.from(scan.always),
    metadata: {
      command: normalizeUrls(command),
      ...(description ? { description } : {}),
      ...metadata,
      ...(degraded ? { [ACTION_GATE_DEGRADED_KEY]: true, [ACTION_GATE_REASON_KEY]: degraded } : {}),
    },
  })
})

// kilocode_change start - share bash permission scanning with Kilo interactive terminal
type PermissionInput = {
  command: string
  cwd: string
  shell: string
  description?: string
  escalate?: boolean // kilocode_change
}

export const ShellPermission = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner
  const fs = yield* FSUtil.Service

  const cygpath = Effect.fn("ShellTool.cygpath")(function* (shell: string, text: string) {
    const lines = yield* spawner
      .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))
    const file = lines[0]?.trim()
    if (!file) return
    return FSUtil.normalizePath(file)
  })

  const resolve = Effect.fn("ShellTool.resolvePath")(function* (text: string, root: string, shell: string) {
    if (process.platform === "win32") {
      if (Shell.posix(shell) && text.startsWith("/") && FSUtil.windowsPath(text) === text) {
        const file = yield* cygpath(shell, text)
        if (file) return file
      }
      return FSUtil.normalizePath(path.resolve(root, FSUtil.windowsPath(text)))
    }
    return path.resolve(root, text)
  })

  const argpath = Effect.fn("ShellTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
    const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
    const file = text && prefix(text)
    if (!file || dynamic(file, ps)) return
    const next = ps ? provider(file) : file
    if (!next) return
    return yield* resolve(next, cwd, shell)
  })

  const collect = Effect.fn("ShellTool.collect")(function* (
    root: Node,
    cwd: string,
    ps: boolean,
    shell: string,
    instance: InstanceContext,
  ) {
    const scan: Scan = {
      dirs: new Set<string>(),
      patterns: new Set<string>(),
      always: new Set<string>(),
      access: "read",
    }
    const kind = ShellID.toKind(Shell.name(shell))

    const nodes = commands(root)
    if (root.descendantsOfType("file_redirect").length > 0) scan.access = "unknown"
    if (nodes.some((node) => !READ.has((ps ? parts(node)[0]?.text.toLowerCase() : parts(node)[0]?.text) ?? ""))) {
      scan.access = "unknown"
    }

    for (const node of nodes) {
      const command = parts(node)
      const tokens = command.map((item) => item.text)
      const cmd = ps || kind === "cmd" ? tokens[0]?.toLowerCase() : tokens[0]

      if (cmd && (FILES.has(cmd) || (kind === "cmd" && CMD_FILES.has(cmd)))) {
        const accessKind = access(cmd, node)
        for (const arg of pathArgs(command, ps, kind === "cmd")) {
          const resolved = yield* argpath(arg, cwd, ps, shell)
          yield* Effect.logInfo("resolved path", { arg, resolved })
          if (!resolved || containsPath(resolved, instance)) continue
          const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
          scan.dirs.add(dir)
          if (accessKind !== "read") scan.access = "unknown"
        }
      }

      if (tokens.length && (!cmd || !CWD.has(cmd))) {
        scan.patterns.add(source(node))
        scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
      }
    }

    // kilocode_change start - fail closed on commands the grammar failed to parse (#12326)
    const lost = unparsed(root, nodes.length)
    if (lost.length > 0) scan.access = "unknown"
    for (const pattern of lost) {
      scan.patterns.add(pattern)
    }
    // kilocode_change end

    return scan
  })

  const check = Effect.fn("ShellTool.permission")(function* (ctx: Tool.Context, input: PermissionInput) {
    const instance = yield* InstanceState.context
    const ps = Shell.ps(input.shell)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const tree = yield* Effect.acquireRelease(parse(input.command, ps), (tree) => Effect.sync(() => tree.delete()))
        const scan = yield* collect(tree.rootNode, input.cwd, ps, input.shell, instance)
        const metadata = heredocs(tree.rootNode, ShellID.toKind(Shell.name(input.shell))) // kilocode_change
        if (!containsPath(input.cwd, instance)) {
          scan.dirs.add(input.cwd)
          scan.access = "unknown"
        }
        // kilocode_change start - ActionGate tripwire #1: block destructive `rm -rf` of a critical path,
        // regardless of intent. Targets are extracted from the parse tree and resolved against the
        // effective cwd (never a regex over the raw command). Blocking fails the permission check,
        // which surfaces to the agent as a tool error (deny-and-continue), not a session halt.
        if (ActionGate.enabled) {
          for (const node of commands(tree.rootNode)) {
            const tokens = parts(node).map((item) => item.text)
            const rm = ActionGate.analyzeRm(tokens)
            if (!rm.destructive) continue
            // Resolve each target against the effective cwd. argpath returns undefined for dynamic or
            // unresolvable targets ($HOME, $PWD, globs); we keep those as `resolved: undefined` so the
            // gate can fail closed instead of silently allowing them.
            const targets: ActionGate.RmTarget[] = []
            for (const arg of rm.paths) {
              const resolved = yield* argpath(arg, input.cwd, ps, input.shell)
              targets.push({ raw: arg, resolved })
            }
            const verdict = ActionGate.checkDestructiveRm(targets, input.cwd, instance.directory)
            if (verdict.block) throw new Error(verdict.reason)
          }
        }
        // kilocode_change end
        // kilocode_change start - ActionGate stage 2: reasoning-blind classifier (KILO_ACTION_CLASSIFIER=1).
        // Order: deterministic tripwire (above) -> proven read-only fast path -> classifier -> ask() below.
        // A classifier block surfaces as a tool error (deny-and-continue); a classifier infra FAILURE (ask)
        // tags the bash ask below as degraded so it force-prompts a human (fail-safe escalation).
        let degradedReason: ActionJudge.AskCode | undefined = undefined
        if (ActionJudge.enabled) {
          const root = tree.rootNode
          const cmdList: ActionJudge.ShellCommand[] = commands(root).map((node) => {
            const toks = parts(node).map((item) => item.text)
            return { executable: ActionJudge.basename(toks[0] ?? ""), args: toks }
          })
          const flags = {
            hasRedirect:
              root.descendantsOfType("file_redirect").length > 0 || root.descendantsOfType("heredoc_redirect").length > 0,
            hasSubstitution:
              root.descendantsOfType("command_substitution").length > 0 ||
              root.descendantsOfType("process_substitution").length > 0,
            hasError: root.descendantsOfType("ERROR").length > 0,
          }
          const readOnly = ActionJudge.provenReadOnly(cmdList, flags)
          // Structural view; ctx.messages (SessionV1.WithParts[]) matches ActionJudge.MessageView by shape.
          const { intent, model } = ActionJudge.selectIntent(
            ctx.messages as unknown as ActionJudge.MessageView[],
            ctx.userMessageID,
          )
          const decision = ActionJudge.route({ tripwireBlocked: false, readOnly, hasIntent: Boolean(intent) })
          if (decision === "intent-missing-block") {
            throw new Error(
              "Blocked by action classifier: cannot verify this command against the user's request (no user intent available).",
            )
          }
          if (decision === "classify") {
            const providerOpt = yield* Effect.serviceOption(Provider.Service)
            const verdict = yield* ActionJudge.classify(
              providerOpt,
              model,
              { surface: "shell", userIntent: intent!, cwd: input.cwd, command: input.command, commands: cmdList },
              ctx.abort,
              ctx.sessionID,
              ctx.callID ?? "",
            )
            // block -> tool error; ask (classifier infra failure) -> escalate via the real bash ask below.
            if (verdict.decision === "block") throw new Error(`Blocked by action classifier (${verdict.reasonCode}).`)
            if (verdict.decision === "ask") degradedReason = verdict.reasonCode
          }
        }
        // kilocode_change end
        yield* ask(ctx, scan, input.command, metadata, input.description, degradedReason) // kilocode_change
        const gitMutation = commands(tree.rootNode).some((node) => mutatesGit(node.text))
        if (input.escalate && gitMutation) {
          yield* ctx.ask({
            permission: "sandbox_escalation", // kilocode_change
            patterns: [input.command],
            always: [],
            metadata: {
              command: normalizeUrls(input.command),
              ...(input.description ? { description: input.description } : {}),
              sandboxEscalation: true,
            },
          })
        }
      }),
    )
  })

  // kilocode_change start - expose the tree-sitter scan (sub-command patterns + external-dir globs) for skill-shell batching
  const dirGlob = (dir: string) =>
    process.platform === "win32" ? FSUtil.normalizePathPattern(path.join(dir, "*")) : path.join(dir, "*")
  const decompose = Effect.fn("ShellTool.decompose")(function* (input: {
    command: string
    cwd: string
    shell: string
  }) {
    const instance = yield* InstanceState.context
    const ps = Shell.ps(input.shell)
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const tree = yield* Effect.acquireRelease(parse(input.command, ps), (tree) => Effect.sync(() => tree.delete()))
        const scan = yield* collect(tree.rootNode, input.cwd, ps, input.shell, instance)
        if (!containsPath(input.cwd, instance)) scan.dirs.add(input.cwd)
        return { patterns: Array.from(scan.patterns), dirs: Array.from(scan.dirs, dirGlob) }
      }),
    )
  })
  // kilocode_change end

  return { ask: check, resolve, decompose } // kilocode_change - decompose for skill-shell
})
// kilocode_change end

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    // kilocode_change start - PowerShell args
    return ChildProcess.make(shell, Shell.args(shell, command, cwd), {
      // kilocode_change end
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

export const ShellTool = Tool.define(
  ShellID.ToolID,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service
    const flags = yield* RuntimeFlags.Service
    const permission = yield* ShellPermission // kilocode_change
    const defaultTimeoutMs = flags.bashDefaultTimeoutMs ?? 2 * 60 * 1000

    const shellEnv = Effect.fn("ShellTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      return modelEnv(extra.env) // kilocode_change - model shells must not inherit backend credentials
    })

    const run = Effect.fn("ShellTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
        description: string // kilocode_change
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      let full = ""
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false

      const closeSink = Effect.fnUntraced(function* () {
        const stream = sink
        if (!stream) return
        sink = undefined
        if (stream.destroyed || stream.closed) return
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (settled) return
                settled = true
                stream.off("close", done)
                stream.off("error", done)
                stream.off("finish", done)
                resolve()
              }
              stream.once("close", done)
              stream.once("error", done)
              stream.once("finish", done)
              stream.end(done)
            }),
        ).pipe(Effect.catch(() => Effect.void))
      })

      yield* ctx.metadata({
        metadata: {
          output: "",
        },
      })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(closeSink)
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))

          const reader = yield* Effect.forkScoped(
            // kilocode_change - keep the fiber so trailing output can be drained
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
              const size = Buffer.byteLength(chunk, "utf-8")
              list.push({ text: chunk, size })
              used += size
              while (used > keep && list.length > 1) {
                const item = list.shift()
                if (!item) break
                used -= item.size
                cut = true
              }

              last = preview(last + chunk)

              if (file) {
                sink?.write(chunk)
              } else {
                full += chunk
                if (Buffer.byteLength(full, "utf-8") > limits.maxBytes) {
                  return trunc.write(full).pipe(
                    Effect.andThen((next) =>
                      Effect.sync(() => {
                        file = next
                        cut = true
                        sink = createWriteStream(next, { flags: "a" })
                        full = ""
                      }),
                    ),
                    Effect.andThen(
                      ctx.metadata({
                        metadata: {
                          output: last,
                        },
                      }),
                    ),
                  )
                }
              }

              return ctx.metadata({
                metadata: {
                  output: last,
                },
              })
            }),
          )

          const abort = Effect.callback<void>((resume) => {
            if (ctx.abort.aborted) return resume(Effect.void)
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
          })

          const timeout = Effect.sleep(`${CommandTimeout.duration(input.timeout)} millis`) // kilocode_change

          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
            timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            aborted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }

          // kilocode_change start - closing the scope interrupts the reader fiber, which can drop
          // buffered output that arrived just before the process exited. Wait for the stream to
          // finish (it ends once stdio closes) so fast commands do not lose their final chunks.
          yield* Fiber.await(reader).pipe(Effect.timeout("3 seconds"), Effect.ignore)
          // kilocode_change end

          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

      const meta: string[] = []
      if (expired) {
        // kilocode_change start
        meta.push(
          CommandTimeout.message(input.timeout, "shell tool terminated command") ??
            `shell tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
        )
        // kilocode_change end
      }
      if (aborted) meta.push("User aborted the command")
      const raw = list.map((item) => item.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) {
        file = yield* trunc.write(raw)
      }

      let output = end.text
      if (!output) output = "(no output)"

      if (cut && file) {
        output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      }

      if (meta.length > 0) {
        output += "\n\n<shell_metadata>\n" + meta.join("\n") + "\n</shell_metadata>"
      }
      return {
        title: input.description, // kilocode_change - UI shows the model's description, command goes in metadata
        metadata: {
          output: last || preview(output),
          exit: code,
          description: input.description, // kilocode_change
          truncated: cut,
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
    })

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = Shell.acceptable(cfg.shell)
        const name = Shell.name(shell)
        const limits = yield* trunc.limits()
        const prompt = ShellPrompt.render(name, process.platform, limits, defaultTimeoutMs)
        yield* Effect.logInfo("shell tool using shell", { shell })

        return {
          description: prompt.description,
          parameters: prompt.parameters,
          execute: (params: Parameters, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const instanceCtx = yield* InstanceState.context
              const cwd = params.workdir
                ? yield* permission.resolve(params.workdir, instanceCtx.directory, shell)
                : instanceCtx.directory
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }
              const timeout = CommandTimeout.clamp(params.timeout ?? defaultTimeoutMs).timeout // kilocode_change
              const sandboxed = ctx.extra?.["sandboxed"] === true
              yield* permission.ask(ctx, {
                command: params.command,
                cwd,
                shell,
                description: params.description,
                escalate: sandboxed, // kilocode_change
              }) // kilocode_change
              const approved = ctx.extra?.["sandboxEscalation"] === true
              if (ctx.extra) ctx.extra["sandboxEscalation"] = false
              return yield* SandboxPolicy.executeEscalated(
                approved,
                run(
                  {
                    shell,
                    command: params.command,
                    cwd,
                    env: yield* shellEnv(ctx, cwd),
                    timeout,
                    description: params.description ?? params.command, // kilocode_change
                  },
                  ctx,
                ),
              )
            }),
        }
      })
  }),
)
