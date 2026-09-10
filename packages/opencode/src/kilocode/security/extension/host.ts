import { existsSync, readFileSync, realpathSync, statSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { backendSupport, prepareLaunch, readConfinementSupport, type Profile } from "@kilocode/sandbox"
import { SecurityGate } from "../gate"
import { SecretContent } from "../state/content"
import { SecuritySessionState } from "../state/store"
import { ExtensionProtocol } from "./protocol"
import type { ToolCapabilityName } from "../types"

/**
 * Permissioned extension host.
 *
 * The code-trust boundary answers "may this repository-controlled module be loaded at all". It does
 * not change what an approved module may then do: imported into the main Kilo process, it would
 * inherit every authority that process has. This module answers the second question — *with what
 * authority does an approved extension run* — by not running it here at all.
 *
 * An approved extension is evaluated in a child process, launched under the OS sandbox profile Kilo
 * already ships (`sandbox-exec` on macOS, bubblewrap on Linux) with writes confined to a scratch
 * directory and the network denied. Privileged effects are not available to it directly; it asks the
 * main process through a closed set of operations, and each request is adjudicated by the same
 * security engine that adjudicates the model's own tool calls, carrying the extension's identity.
 *
 * What that does and does not buy is measured rather than asserted: `backendSupport()` decides whether
 * the OS profile could be applied at all, `confined` records the answer, and the benchmark's runtime
 * scenarios show which direct APIs the boundary actually stops on this machine. Where the profile is
 * unavailable the process boundary still removes shared memory and the host's module graph, and that
 * is all this module claims there.
 */
export namespace ExtensionHost {
  const log = Log.create({ service: "security" })

  const ENTRY = path.join(import.meta.dir, "host-entry.ts")

  /** Live child processes, so Kilo never leaves an extension host behind when it exits. */
  const live = new Set<{ kill: () => void }>()
  let cleanup = false
  function track(proc: { kill: () => void }) {
    live.add(proc)
    if (cleanup) return
    cleanup = true
    process.once("exit", () => {
      for (const item of live) {
        try {
          item.kill()
        } catch {
          // best effort on the way out
        }
      }
    })
  }
  const MAX_FILE = 4 * 1024 * 1024
  /** How long a mediated `process.spawn` may run before it is killed. */
  const SPAWN_TIMEOUT = 30_000
  const MAX_SPAWN_OUTPUT = 64 * 1024
  const START_TIMEOUT = 15_000
  const CALL_TIMEOUT = 30_000

  export interface StartInput {
    identity: ExtensionProtocol.Identity
    /** Approved entrypoint to evaluate inside the host. */
    file: string
    /** Disposable directory the host may write to directly. */
    scratch: string
    /** Security Auto options used to adjudicate the extension's capability requests. */
    options: SecurityGate.Options
    /** Session the extension acts on behalf of, when it is running inside one. */
    sessionID?: string
    /**
     * The user has accepted an extension host with ambient read access to their files. It both turns
     * read confinement off where the platform supports it and permits activation where it does not;
     * without it, a platform that cannot confine reads refuses to run the extension at all.
     */
    allowUnconfinedReads?: boolean
  }

  export interface Handle {
    identity: ExtensionProtocol.Identity
    /** True when the OS sandbox profile was applied to the child process. */
    confined: boolean
    /** True when that profile also confined what the child may read. */
    readConfined: boolean
    tools: { id: string; description: string }[]
    hooks: string[]
    invoke(tool: string, args: unknown, sessionID?: string): Promise<{ ok: boolean; output?: string; error?: string }>
    trigger(name: string, input: unknown, output: unknown, sessionID?: string): Promise<void>
    stop(): void
    /** Capability requests refused, for audit and tests. Never holds file contents. */
    refusals: { op: string; reason: string }[]
  }

  /** Environment variables an extension host is never given, whatever the parent process holds. */
  const DENIED_ENV = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "KILO_API_KEY",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "NPM_TOKEN",
  ]

  /**
   * Immutable operating-system locations a runtime has to read to start at all. None of them is a
   * place user credentials live; the user's home directory is deliberately not among them.
   */
  const SYSTEM_READ: Record<string, string[]> = {
    darwin: ["/usr", "/bin", "/sbin", "/System", "/Library", "/opt", "/dev", "/private/var/db", "/private/var/select"],
    // `/proc` and `/sys` are deliberately absent. The Linux backend already gives the child a fresh
    // private `/proc` of its own, so binding the host's added nothing an extension could use — while
    // costing a recursive deny-name walk over every process on the machine, and then failing outright
    // because a tmpfs cannot be mounted over `/proc/<pid>/ns`. Nothing an extension legitimately
    // reads lives in either tree.
    linux: ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt", "/dev"],
  }

  /**
   * Names that stay unreadable even inside an allowed subtree, so a credential store that happens to
   * sit in the workspace is not ambient-readable either. Content behind these names is still reachable
   * through the mediated capability path, where policy decides.
   */
  const DENY_NAMES = [
    ".ssh",
    ".aws",
    ".gnupg",
    ".kube",
    ".docker",
    ".netrc",
    ".npmrc",
    ".git-credentials",
    ".env",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
  ]

  function canonical(target: string): string | undefined {
    try {
      return realpathSync(target)
    } catch {
      return existsSync(target) ? target : undefined
    }
  }

  /**
   * One allowed subtree, named by both spellings when the platform has two.
   *
   * The canonical path is what actually gets bound, but the original has to be bound as well when
   * it differs: on a usr-merged Linux `/lib64` is a symlink to `/usr/lib64`, and binding only the
   * target leaves no `/lib64` inside the sandbox root — so the dynamic loader the interpreter names
   * (`/lib64/ld-linux-x86-64.so.2`) is not there and the child dies with a bare `execvp: No such
   * file or directory`. Both spellings resolve to the same directory, so naming both adds no reach.
   */
  function subtree(target: string | undefined) {
    const resolved = target ? canonical(target) : undefined
    if (!resolved) return []
    const out = [{ path: resolved, kind: "subtree" as const }]
    if (target && target !== resolved && existsSync(target)) out.push({ path: target, kind: "subtree" as const })
    return out
  }

  export interface ProfileInput {
    /** Disposable directory the host may write to directly. */
    scratch: string
    /** The workspace the extension was discovered in: its legitimate working set. */
    workspace: string
    /** The approved entrypoint; its directory holds the local modules it may import. */
    entry: string
    /** When false the profile leaves ambient reads open, as the runtime did before confinement. */
    confineReads?: boolean
  }

  /**
   * The profile an extension host runs under.
   *
   * Writes go to the scratch directory and nowhere else, the network is denied, and — when the
   * platform can enforce it — ambient reads are confined to what an extension legitimately needs: the
   * runtime, its own code, the workspace it belongs to and its scratch directory. Everything else,
   * the rest of the user's home included, is simply not readable. Reads the extension has a real
   * reason to make outside that set go through the mediated capability path, where the security engine
   * decides and the content classifier sees what came back.
   */
  export function profileFor(input: ProfileInput): Profile {
    const scratch = canonical(input.scratch) ?? input.scratch
    const allowRead = input.confineReads
      ? [
          ...(SYSTEM_READ[process.platform] ?? []).flatMap((item) => subtree(item)),
          // The runtime binary and the host entry Kilo evaluates inside the child.
          ...subtree(path.dirname(process.execPath)),
          ...subtree(import.meta.dir),
          // The extension's own directory: the entrypoint plus the local modules of its closure.
          ...subtree(path.dirname(input.entry)),
          ...subtree(input.workspace),
          { path: scratch, kind: "subtree" as const },
        ]
      : undefined
    return {
      filesystem: {
        allowWrite: [{ path: scratch, kind: "subtree" }],
        denyWrite: [],
        denyNames: input.confineReads ? DENY_NAMES : [],
        ...(allowRead
          ? {
              allowRead,
              // Kilo's own configuration and state decide what is trusted; an extension never reads them.
              denyRead: [...subtree(Global.Path.config), ...subtree(Global.Path.state)],
            }
          : {}),
        temporaryDirectory: scratch,
      },
      network: { mode: "deny", allowedHosts: [] },
      environment: { deny: DENIED_ENV, set: {} },
    }
  }

  export function sandboxAvailable(): boolean {
    return backendSupport({ mode: "deny", allowedHosts: [] }).available
  }

  /** Whether this platform can confine what an extension host reads, not merely what it writes. */
  export function readConfinementAvailable(): boolean {
    return readConfinementSupport({ mode: "deny", allowedHosts: [] }).available
  }

  /**
   * The escape hatch for a platform that cannot confine reads. It is deliberately global-config only
   * and deliberately explicit: without it an approved workspace extension does not run there at all,
   * rather than quietly running with ambient read access to the user's files.
   */
  export function unconfinedReadsAllowed(global: unknown): boolean {
    const experimental = (global as { experimental?: Record<string, unknown> } | undefined)?.experimental
    return experimental?.["security_auto_extension_unconfined_reads"] === true
  }

  /**
   * Whether a host may start at all. Where reads cannot be confined the answer is no: an approved
   * extension running with the user's own read authority is the thing this boundary exists to prevent,
   * so it fails safe instead of downgrading, and only the user's own configuration can override it.
   */
  export function activation(input: { readConfined: boolean; allowUnconfinedReads?: boolean; reason?: string }) {
    if (input.readConfined) return { allow: true, reason: "read-confined" }
    if (input.allowUnconfinedReads) return { allow: true, reason: "unconfined-reads-accepted" }
    return { allow: false, reason: `read-confinement-unavailable:${input.reason ?? "unsupported"}` }
  }

  function environmentFor(workspace: string) {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue
      if (DENIED_ENV.includes(key)) continue
      if (/_API_KEY$|^KILO_|TOKEN$|SECRET/i.test(key)) continue
      out[key] = value
    }
    out["KILO_EXTENSION_HOST"] = "1"
    out["PWD"] = workspace
    return out
  }

  /**
   * Adjudicate one capability request. Two gates, in order: the capability the user granted for this
   * approved content, then the ordinary security engine on the concrete arguments — so a granted
   * `filesystem-write` still cannot write to `~/.ssh`, and an outbound request still composes with the
   * session's secret state.
   */
  export function adjudicate(input: {
    identity: ExtensionProtocol.Identity
    request: ExtensionProtocol.Capability
    options: SecurityGate.Options
    sessionID: string
    workspace: string
  }): Promise<{ allow: boolean; reason: string }> {
    const op = input.request.op
    if (!ExtensionProtocol.CAPABILITY_OPS.has(op)) return Promise.resolve({ allow: false, reason: "unknown-operation" })
    const required = ExtensionProtocol.REQUIRED[op]
    if (required && !input.identity.granted.includes(required)) {
      return Promise.resolve({ allow: false, reason: `capability-not-granted:${required}` })
    }

    // Each request is adjudicated as the operation it *is*, not as everything the extension was
    // granted: a read stays a read, so the outbound rules apply to sends rather than to every call an
    // outbound-capable extension makes.
    const descriptor = {
      tool: input.identity.id ?? "extension",
      provenance: "workspace" as const,
      capabilities: required ? [required] : [],
      source: "declared" as const,
      asks: false,
    }
    const request = ((): SecurityGate.Request => {
      const security = { descriptor, args: input.request as unknown as Record<string, unknown> }
      switch (input.request.op) {
        case "fs.read":
          return {
            permission: "read",
            patterns: [input.request.path],
            always: [],
            metadata: { filepath: input.request.path },
            security,
          }
        case "fs.write":
          return {
            permission: "edit",
            patterns: [input.request.path],
            always: [],
            metadata: { filepath: input.request.path },
            security,
          }
        case "net.request":
          return { permission: "webfetch", patterns: [input.request.url], always: [], metadata: {}, security }
        case "process.spawn":
          return {
            permission: "bash",
            patterns: [input.request.command],
            always: [],
            metadata: { command: input.request.command, cwd: input.workspace },
            security,
          }
      }
    })()

    return Effect.runPromise(
      SecurityGate.evaluate({
        request,
        options: input.options,
        sessionID: input.sessionID,
        agent: "extension",
      }),
    ).then((decision) => {
      // An extension has no prompt of its own: an action that needs a human is refused rather than
      // silently escalated. Only what policy allows unattended is performed for it.
      if (decision.action === "deny") return { allow: false, reason: `denied:${decision.reasonCode}` }
      if (decision.action === "ask" && decision.hard)
        return { allow: false, reason: `needs-approval:${decision.reasonCode}` }
      return { allow: true, reason: "allowed" }
    })
  }

  async function perform(
    request: ExtensionProtocol.Capability,
    workspace: string,
    session: string,
    options: SecurityGate.Options,
  ): Promise<unknown> {
    switch (request.op) {
      case "fs.read": {
        const stat = statSync(request.path)
        if (!stat.isFile() || stat.size > MAX_FILE) throw new Error("file is not readable")
        const text = readFileSync(request.path, "utf8")
        // The extension really obtained this content, so it composes with the existing session state
        // exactly as a tool result does: no second taint layer, no separate policy.
        if (options.layers?.content && options.layers.egress) {
          const found = SecretContent.classify(text, { file: request.path })
          if (found.labels.length > 0) {
            SecuritySessionState.apply(
              session,
              {
                reads: [],
                taints: [],
                untaints: [],
                candidates: [{ canonical: request.path, relation: "workspace" }],
              },
              undefined,
              {
                labels: found.labels,
                values: found.values,
                kinds: [...new Set(found.findings.map((item) => item.kind))],
                source: `extension:${request.path}`,
              },
            )
          }
        }
        return text
      }
      case "fs.write": {
        mkdirSync(path.dirname(request.path), { recursive: true })
        writeFileSync(request.path, request.data)
        return null
      }
      case "net.request": {
        const response = await fetch(request.url, {
          method: request.method ?? "GET",
          ...(request.body === undefined ? {} : { body: request.body }),
        })
        return `status ${response.status}`
      }
      case "process.spawn": {
        /**
         * A mediated spawn is bounded, because the thing it starts is not.
         *
         * The command has already been through the engine on its concrete arguments, but the process
         * it launches is an arbitrary program: without a deadline, `await proc.exited` on something
         * that never exits holds the capability channel open for the rest of the session, and the
         * extension only has to ask once. The environment is the host's scrubbed one rather than
         * Kilo's, so a granted `process` does not become a way to read the credentials the host
         * profile was built to keep out.
         *
         * Residual, and named rather than implied: this runs in the main process, not inside the
         * extension's OS profile. The engine decides whether it may run at all; the profile does not
         * contain what it then does.
         */
        // stderr is piped nowhere and never read, so it is not piped at all: a pipe nobody drains
        // fills, and a child blocked writing to it would sit there until the deadline killed it.
        const proc = Bun.spawn(["/bin/sh", "-c", request.command], {
          cwd: workspace,
          env: environmentFor(workspace),
          stdout: "pipe",
          stderr: "ignore",
        })
        const timer = setTimeout(() => proc.kill("SIGKILL"), SPAWN_TIMEOUT)
        try {
          // Read to the cap and stop, rather than buffering everything and slicing afterwards: the
          // cap is there so a granted `process` cannot spend the host's memory, and a slice applied
          // after the fact has already spent it.
          const decoder = new TextDecoder()
          let out = ""
          for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
            out += decoder.decode(chunk, { stream: true })
            if (out.length >= MAX_SPAWN_OUTPUT) {
              out = out.slice(0, MAX_SPAWN_OUTPUT)
              proc.kill("SIGKILL")
              break
            }
          }
          await proc.exited
          return out
        } finally {
          clearTimeout(timer)
          if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
        }
      }
    }
  }

  /** Start a host for one approved extension and load it inside. */
  export async function start(input: StartInput): Promise<Handle> {
    mkdirSync(input.scratch, { recursive: true })
    const workspace = input.options.workspace.directory
    const wanted = sandboxAvailable() && !input.allowUnconfinedReads && readConfinementAvailable()
    const base = {
      command: process.execPath,
      args: ["run", ENTRY],
      cwd: workspace,
      environment: environmentFor(workspace),
    }
    const profile = profileFor({
      scratch: input.scratch,
      workspace,
      entry: input.file,
      confineReads: wanted,
    })
    // Whether the profile was applied is the answer the backend gives, not an assumption: a profile
    // that failed to build must not leave a host running unconfined while the handle claims otherwise.
    const prepared = sandboxAvailable()
      ? await Effect.runPromise(
          Effect.scoped(prepareLaunch(profile, base)).pipe(
            Effect.map((launch) => ({ launch, applied: true })),
            Effect.catch(() => Effect.succeed({ launch: base, applied: false })),
          ),
        )
      : { launch: base, applied: false }
    const launch = prepared.launch
    const confined = prepared.applied
    const readConfined = confined && wanted
    const permitted = activation({
      readConfined,
      allowUnconfinedReads: input.allowUnconfinedReads,
      reason: readConfinementSupport({ mode: "deny", allowedHosts: [] }).reason ?? "profile could not be applied",
    })
    if (!permitted.allow) throw new Error(`extension host refused to start: ${permitted.reason}`)

    const proc = Bun.spawn([launch.command, ...launch.args], {
      cwd: launch.cwd,
      env: launch.environment as Record<string, string>,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    })

    track(proc)
    proc.unref?.()
    const refusals: { op: string; reason: string }[] = []
    const waiting = new Map<number, (event: ExtensionProtocol.Event) => void>()
    let ready = false
    let readyResolve: (() => void) | undefined
    const readyPromise = new Promise<void>((resolve) => (readyResolve = resolve))
    let sequence = 1
    let session = input.sessionID ?? `ext:${input.identity.digest.slice(0, 16)}`

    /**
     * One call at a time per host, because the session a capability request belongs to is held in a
     * binding rather than carried on the wire. The child's capability events arrive asynchronously
     * and name only their own id, so with two invocations in flight the second one's `sessionID`
     * would decide how the first one's reads and sends were adjudicated — and the secret context of
     * the wrong session is the one thing this layer composes with. Serialising costs nothing here:
     * the host is a single extension behind a single stdio pipe.
     */
    let queue: Promise<unknown> = Promise.resolve()
    function serialised<T>(fn: () => Promise<T>): Promise<T> {
      const next = queue.then(fn, fn)
      queue = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    }

    const write = (command: ExtensionProtocol.Command) => {
      void proc.stdin.write(ExtensionProtocol.encode(command))
      void proc.stdin.flush()
    }

    async function onCapability(event: Extract<ExtensionProtocol.Event, { kind: "capability" }>) {
      const verdict = await adjudicate({
        identity: input.identity,
        request: event.request,
        options: input.options,
        sessionID: session,
        workspace,
      }).catch(() => ({ allow: false, reason: "adjudication-failed" }))
      if (!verdict.allow) {
        refusals.push({ op: event.request.op, reason: verdict.reason })
        log.info("extension capability refused", {
          op: event.request.op,
          reason: verdict.reason,
          extension: input.identity.id ?? path.basename(input.identity.source),
        })
        write({ kind: "capability-result", id: event.id, ok: false, error: verdict.reason })
        return
      }
      try {
        const value = await perform(event.request, workspace, session, input.options)
        write({ kind: "capability-result", id: event.id, ok: true, value })
      } catch (error) {
        write({ kind: "capability-result", id: event.id, ok: false, error: String(error) })
      }
    }

    void (async () => {
      let buffer = ""
      for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
        buffer += Buffer.from(chunk).toString("utf8")
        let index = buffer.indexOf("\n")
        while (index >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          const event = ExtensionProtocol.decode<ExtensionProtocol.Event>(line)
          if (event) {
            if (event.kind === "ready") {
              ready = true
              readyResolve?.()
            } else if (event.kind === "capability") {
              void onCapability(event)
            } else {
              waiting.get(event.id)?.(event)
            }
          }
          index = buffer.indexOf("\n")
        }
      }
    })()

    type Outgoing =
      | { kind: "load"; file: string; type: ExtensionProtocol.Identity["type"] }
      | { kind: "invoke"; tool: string; args: unknown }
      | { kind: "hook"; name: string; input: unknown; output: unknown }
    const call = <T extends ExtensionProtocol.Event>(command: Outgoing): Promise<T> => {
      const id = sequence++
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error("extension host timed out"))
        }, CALL_TIMEOUT)
        waiting.set(id, (event) => {
          clearTimeout(timer)
          waiting.delete(id)
          resolve(event as T)
        })
        write({ ...command, id } as ExtensionProtocol.Command)
      })
    }

    await Promise.race([
      readyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("extension host did not start")), START_TIMEOUT),
      ),
    ]).catch((error) => {
      proc.kill()
      throw error
    })
    void ready

    const loaded = await call<Extract<ExtensionProtocol.Event, { kind: "loaded" | "failed" }>>({
      kind: "load",
      file: input.file,
      type: input.identity.type,
    })
    if (loaded.kind !== "loaded") {
      proc.kill()
      throw new Error(`extension failed to load: ${loaded.error}`)
    }

    return {
      identity: input.identity,
      confined,
      readConfined,
      tools: loaded.tools,
      hooks: loaded.hooks,
      refusals,
      invoke(tool, args, sessionID) {
        return serialised(async () => {
          if (sessionID) session = sessionID
          const result = await call<Extract<ExtensionProtocol.Event, { kind: "invoked" }>>({
            kind: "invoke",
            tool,
            args,
          })
          return {
            ok: result.ok,
            ...(result.output ? { output: result.output } : {}),
            ...(result.error ? { error: result.error } : {}),
          }
        })
      },
      trigger(name, hookInput, output, sessionID) {
        return serialised(async () => {
          if (sessionID) session = sessionID
          if (!loaded.hooks.includes(name)) return
          await call<Extract<ExtensionProtocol.Event, { kind: "hooked" }>>({
            kind: "hook",
            name,
            input: hookInput,
            output,
          }).catch(() => undefined)
        })
      },
      stop() {
        try {
          write({ kind: "shutdown", id: sequence++ })
        } catch {
          // the child may already be gone
        }
        live.delete(proc)
        proc.kill()
      },
    }
  }

  /** Capabilities a workspace extension gets when the user approved its code but granted nothing. */
  export const DEFAULT_GRANTS: ToolCapabilityName[] = ["filesystem-read"]

  /**
   * Grants the user recorded for an approved digest, from the global config. An approved digest with
   * no grant entry keeps the conservative default rather than inheriting the process's authority —
   * which is the migration rule for extensions approved before this boundary existed.
   */
  export function grantsFor(global: unknown, digest: string): ToolCapabilityName[] {
    const experimental = (global as { experimental?: Record<string, unknown> } | undefined)?.experimental
    const raw = experimental?.["security_auto_extension_grants"]
    if (typeof raw !== "object" || raw === null) return [...DEFAULT_GRANTS]
    const entry = (raw as Record<string, unknown>)[digest]
    if (!Array.isArray(entry)) return [...DEFAULT_GRANTS]
    const known = new Set<ToolCapabilityName>([
      "readonly",
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
      "package",
      "delegated-authority",
      "security-control",
    ])
    const granted = entry.filter((item): item is ToolCapabilityName => known.has(item as ToolCapabilityName))
    return granted.length > 0 ? [...new Set([...DEFAULT_GRANTS, ...granted])] : [...DEFAULT_GRANTS]
  }
}
