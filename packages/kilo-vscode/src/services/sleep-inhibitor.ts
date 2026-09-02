import type { ChildProcess } from "child_process"
import * as vscode from "vscode"
import type {
  KiloClient,
  PermissionRequest,
  PermissionV2Request,
  QuestionRequest,
  QuestionV2Request,
  SessionNetworkWait,
  SessionStatus,
} from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "./cli-backend/connection-service"
import type { SSEPayload } from "./cli-backend/sdk-sse-adapter"
import { t } from "./i18n"
import { spawn } from "../util/process"

const DEFAULT_TIMEOUT = 30
const READY = "KILO_SLEEP_INHIBITOR_READY"
const CONNECTION_GRACE = 30_000

export type InhibitionHandle = symbol

type NativeProcess = Pick<ChildProcess, "kill" | "once" | "stdin" | "stdout">

type Command = {
  cmd: string
  args: string[]
  input?: boolean
  ready?: string
}

type Options = {
  platform?: NodeJS.Platform
  pid?: number
  launch?: (cmd: string, args: string[], output: boolean, input: boolean) => NativeProcess
  retry?: (attempt: number) => number
  startup?: number
  grace?: number
  log?: (message: string) => void
  active?: (active: boolean) => void
}

type SessionOptions = {
  timeout?: () => number
  reason?: (title: string) => string
  now?: () => number
  log?: (message: string) => void
}

type Task = {
  title: string
  directory?: string
  used: number
  handle?: InhibitionHandle
  started?: number
  timer?: ReturnType<typeof setTimeout>
}

type Snapshot = {
  changed: Set<string>
  waits: Set<string>
  titles: Set<string>
  baseline: Map<string, string | undefined>
}

type Active = Map<string, { directory: string; status: SessionStatus }>
type Pending = Map<string, Set<string>>
type QuestionTool = { sessionID: string; messageID: string; callID: string }
type Requests = {
  pending: Pending
  tools: Map<string, QuestionTool>
  prefixes: Set<string>
  errors: unknown[]
}
type Restored = { active: Active; ok: Set<string> }
type Settled<T> = PromiseSettledResult<{ data?: T; error?: unknown }>
type Read<T> = { data?: T; ok: boolean; error?: unknown }

function add(pending: Pending, sessionID: string, requestID: string): void {
  const waits = pending.get(sessionID) ?? new Set<string>()
  waits.add(requestID)
  pending.set(sessionID, waits)
}

function read<T>(result: Settled<T>): Read<T> {
  if (result.status === "rejected") return { ok: false, error: result.reason }
  if (result.value.error) return { ok: false, error: result.value.error }
  return { data: result.value.data, ok: true }
}

function remember(
  tools: Map<string, QuestionTool>,
  request: { id: string; sessionID: string; tool?: { messageID: string; callID: string } },
): void {
  if (!request.tool) return
  tools.set(request.id, { sessionID: request.sessionID, ...request.tool })
}

function questions(
  pending: Pending,
  tools: Map<string, QuestionTool>,
  legacy?: QuestionRequest[],
  modern?: QuestionV2Request[],
) {
  for (const request of legacy ?? []) {
    if (request.blocking === false) continue
    add(pending, request.sessionID, `question:${request.id}`)
    remember(tools, request)
  }
  for (const request of modern ?? []) {
    add(pending, request.sessionID, `question:${request.id}`)
    remember(tools, request)
  }
}

function permissions(pending: Pending, legacy?: PermissionRequest[], modern?: PermissionV2Request[]): void {
  for (const request of legacy ?? []) add(pending, request.sessionID, `permission:${request.id}`)
  for (const request of modern ?? []) add(pending, request.sessionID, `permission:${request.id}`)
}

function network(pending: Pending, waits?: SessionNetworkWait[]): void {
  for (const request of waits ?? []) {
    if (!request.restored) add(pending, request.sessionID, `network:${request.id}`)
  }
}

async function requests(client: KiloClient, directory: string): Promise<Requests> {
  const [legacyQuestions, legacyPermissions, networkWaits, modernQuestions, modernPermissions] =
    await Promise.allSettled([
      client.question.list({ directory }),
      client.permission.list({ directory }),
      client.network.list({ directory }),
      client.v2.question.request.list({ location: { directory } }),
      client.v2.permission.request.list({ location: { directory } }),
    ])
  const q = read(legacyQuestions)
  const p = read(legacyPermissions)
  const n = read(networkWaits)
  const q2 = read(modernQuestions)
  const p2 = read(modernPermissions)
  const pending: Pending = new Map()
  const tools = new Map<string, QuestionTool>()
  const prefixes = new Set<string>()
  const errors = [q.error, p.error, n.error, q2.error, p2.error].filter((error) => error !== undefined)
  questions(pending, tools, q.data, q2.data?.data)
  permissions(pending, p.data, p2.data?.data)
  network(pending, n.data)
  if (q.ok && q2.ok) prefixes.add("question:")
  if (p.ok && p2.ok) prefixes.add("permission:")
  if (n.ok) prefixes.add("network:")
  return { pending, tools, prefixes, errors }
}

function commands(platform: NodeJS.Platform, reason: string, pid: number): Command[] {
  const wait = ["/bin/sh", "-c", `printf '%s\\n' '${READY}'; IFS= read -r _ || true`]
  if (platform === "linux") {
    return [
      {
        cmd: "systemd-inhibit",
        args: ["--what=sleep", "--who=Kilo", `--why=${reason}`, "--mode=block", ...wait],
        input: true,
        ready: READY,
      },
      {
        cmd: "gnome-session-inhibit",
        args: ["--app-id=ai.kilo.code", `--reason=${reason}`, "--inhibit=suspend", ...wait],
        input: true,
        ready: READY,
      },
    ]
  }
  if (platform === "darwin") {
    return [{ cmd: "/usr/bin/caffeinate", args: ["-i", ...wait], input: true, ready: READY }]
  }
  if (platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class KiloPower { [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid); [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint timeout); [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle); }\'',
      `$parent = [KiloPower]::OpenProcess(1048576, $false, [uint32]${pid})`,
      "$error = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
      'if ($parent -eq [IntPtr]::Zero) { throw "Cannot watch parent process ($error)" }',
      "try {",
      "  if ([KiloPower]::SetThreadExecutionState([uint32]2147483649) -eq 0) { throw 'SetThreadExecutionState failed' }",
      "  try {",
      `    [Console]::Out.WriteLine('${READY}')`,
      "    [Console]::Out.Flush()",
      "    $wait = [KiloPower]::WaitForSingleObject($parent, [uint32]::MaxValue)",
      '    if ($wait -ne 0) { throw "Parent wait failed ($wait)" }',
      "  } finally {",
      "    [KiloPower]::SetThreadExecutionState([uint32]2147483648) | Out-Null",
      "  }",
      "} finally {",
      "  [KiloPower]::CloseHandle($parent) | Out-Null",
      "}",
    ].join("\n")
    return [
      {
        cmd: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
        ready: READY,
      },
    ]
  }
  return []
}

export class SleepInhibitor implements vscode.Disposable {
  private readonly refs = new Map<InhibitionHandle, string>()
  private readonly platform: NodeJS.Platform
  private readonly pid: number
  private readonly launch: (cmd: string, args: string[], output: boolean, input: boolean) => NativeProcess
  private readonly retry: (attempt: number) => number
  private readonly startup: number
  private readonly grace: number
  private readonly log: (message: string) => void
  private readonly active: (active: boolean) => void
  private readonly exit = () => this.stop()
  private child: NativeProcess | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private probe: ReturnType<typeof setTimeout> | undefined
  private killer: ReturnType<typeof setTimeout> | undefined
  private token = 0
  private ready = false
  private closing = false
  private shown = false
  private disposed = false

  constructor(opts: Options = {}) {
    this.platform = opts.platform ?? process.platform
    this.pid = opts.pid ?? process.pid
    this.launch =
      opts.launch ??
      ((cmd, args, output, input) =>
        spawn(cmd, args, {
          stdio: [input ? "pipe" : "ignore", output ? "pipe" : "ignore", "ignore"],
        }))
    this.retry = opts.retry ?? ((attempt) => Math.min(1_000 * 2 ** attempt, 30_000))
    this.startup = opts.startup ?? 10_000
    this.grace = opts.grace ?? 1_000
    this.log = opts.log ?? (() => undefined)
    this.active = opts.active ?? (() => undefined)
    process.on("exit", this.exit)
  }

  acquire(reason: string): InhibitionHandle {
    const handle = Symbol(reason)
    if (this.disposed) return handle
    this.refs.set(handle, reason)
    if (!this.child && !this.timer) this.start()
    return handle
  }

  release(handle: InhibitionHandle): void {
    if (!this.refs.delete(handle)) return
    if (this.refs.size === 0) this.stop()
  }

  update(handle: InhibitionHandle, reason: string): void {
    if (!this.refs.has(handle)) return
    this.refs.set(handle, reason)
  }

  releaseAll(): void {
    this.refs.clear()
    this.stop()
  }

  isActive(): boolean {
    return this.ready && this.child !== undefined
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    process.off("exit", this.exit)
    this.releaseAll()
    this.sync()
  }

  private start(attempt = 0): void {
    const entry = this.refs.entries().next().value
    if (!entry) return
    const [, reason] = entry
    const list = commands(this.platform, reason, this.pid)
    if (list.length === 0) {
      this.log(`System sleep inhibition is unsupported on ${this.platform}`)
      return
    }
    this.run(list, 0, attempt)
  }

  private run(list: Command[], index: number, attempt: number): void {
    if (this.disposed || this.refs.size === 0) return
    const item = list[index]
    if (!item) {
      this.log("No system sleep inhibitor is available; tasks will continue normally")
      this.schedule(attempt)
      return
    }

    const child = (() => {
      try {
        return this.launch(item.cmd, item.args, item.ready !== undefined, item.input === true)
      } catch (error) {
        this.log(`${item.cmd} failed: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    })()
    if (!child) {
      this.run(list, index + 1, attempt)
      return
    }

    this.child = child
    this.ready = false
    this.closing = false
    const token = ++this.token
    let failed = false

    const next = (message: string) => {
      if (token !== this.token || this.child !== child) return
      this.clearProbe()
      this.clearKiller()
      this.child = undefined
      this.ready = false
      this.closing = false
      this.sync()
      this.log(message)
      this.run(list, index + 1, attempt)
    }

    const activate = () => {
      if (token !== this.token || this.child !== child || this.closing || this.ready || failed) return
      this.clearProbe()
      this.ready = true
      this.sync()
      this.log(`Started ${item.cmd}`)
    }

    child.once("error", (error) => {
      if (this.closing && this.child === child) {
        this.log(`${item.cmd} could not be stopped cleanly: ${error.message}`)
        return
      }
      next(`${item.cmd} failed: ${error.message}`)
    })
    child.stdin?.once("error", (error) => this.log(`${item.cmd} input closed with an error: ${error.message}`))
    child.once("exit", (code, signal) => {
      if (this.child !== child) return
      if (this.closing) {
        this.finish(child)
        return
      }
      if (token !== this.token) return
      next(`${item.cmd} exited unexpectedly (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`})`)
    })

    if (item.ready) {
      const output = child.stdout
      if (!output) {
        next(`${item.cmd} failed: startup confirmation channel is unavailable`)
        return
      }
      let data = ""
      output.on("data", (chunk) => {
        data = `${data}${String(chunk)}`.slice(-4_096)
        if (data.includes(item.ready ?? "")) activate()
      })
    } else {
      child.once("spawn", activate)
    }

    this.probe = setTimeout(() => {
      if (token !== this.token || this.child !== child || this.ready) return
      failed = true
      this.clearProbe()
      this.log(`${item.cmd} did not confirm system sleep inhibition`)
      this.terminate(child)
    }, this.startup)
    this.probe.unref?.()
  }

  private stop(): void {
    this.token += 1
    this.clearRetry()
    this.clearProbe()
    const child = this.child
    if (!child) {
      this.ready = false
      this.sync()
      return
    }
    this.closing = true
    this.terminate(child)
  }

  private finish(child: NativeProcess): void {
    if (this.child !== child) return
    this.clearProbe()
    this.clearKiller()
    this.child = undefined
    this.ready = false
    this.closing = false
    this.sync()
    if (!this.disposed && this.refs.size > 0) this.start()
  }

  private schedule(attempt: number): void {
    if (this.disposed || this.refs.size === 0 || this.timer) return
    const wait = Math.max(0, this.retry(attempt))
    const token = ++this.token
    this.log(`Retrying system sleep inhibition in ${wait}ms`)
    this.timer = setTimeout(() => {
      if (token !== this.token) return
      this.timer = undefined
      this.start(attempt + 1)
    }, wait)
    this.timer.unref?.()
  }

  private clearRetry(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private clearProbe(): void {
    if (!this.probe) return
    clearTimeout(this.probe)
    this.probe = undefined
  }

  private terminate(child: NativeProcess): void {
    const input = child.stdin
    if (input && !input.destroyed && !input.writableEnded) {
      input.end()
      this.clearKiller()
      this.killer = setTimeout(() => {
        if (this.child !== child) return
        const killed = child.kill()
        if (!killed) this.log("System sleep inhibitor could not be terminated; waiting for process exit")
      }, this.grace)
      this.killer.unref?.()
      return
    }
    const killed = child.kill()
    if (!killed) this.log("System sleep inhibitor could not be terminated; waiting for process exit")
  }

  private clearKiller(): void {
    if (!this.killer) return
    clearTimeout(this.killer)
    this.killer = undefined
  }

  private sync(): void {
    const active = !this.disposed && this.isActive()
    if (this.shown === active) return
    this.shown = active
    this.active(active)
  }
}

export class SessionSleepInhibitor {
  private readonly tasks = new Map<string, Task>()
  private readonly waiting = new Map<string, Set<string>>()
  private readonly timeout: () => number
  private readonly reason: (title: string) => string
  private readonly now: () => number
  private readonly log: (message: string) => void
  private enabled: boolean
  private forced = false

  constructor(
    private readonly inhibitor: SleepInhibitor,
    enabled: boolean,
    opts: SessionOptions = {},
  ) {
    this.enabled = enabled
    this.timeout = opts.timeout ?? (() => DEFAULT_TIMEOUT * 60_000)
    this.reason = opts.reason ?? ((title) => `Task "${title}" is running`)
    this.now = opts.now ?? Date.now
    this.log = opts.log ?? (() => undefined)
  }

  status(sessionID: string, status: SessionStatus, title?: string, directory?: string): void {
    if (status.type === "idle") {
      this.remove(sessionID)
      return
    }
    const task = this.tasks.get(sessionID) ?? { title: title ?? "Task", used: 0 }
    task.directory = directory ?? task.directory
    this.tasks.set(sessionID, task)
    if (title !== undefined) this.title(sessionID, title)
    if (status.type === "offline") {
      this.pause(sessionID, `network:${status.requestID}`)
      return
    }
    this.resumeAll(sessionID, "network:")
    this.acquire(sessionID)
  }

  remove(sessionID: string): void {
    this.deactivate(sessionID)
    this.tasks.delete(sessionID)
    this.waiting.delete(sessionID)
    if (this.tasks.size === 0) this.forced = false
  }

  pause(sessionID: string, requestID: string): void {
    const pending = this.waiting.get(sessionID) ?? new Set<string>()
    pending.add(requestID)
    this.waiting.set(sessionID, pending)
    this.deactivate(sessionID)
  }

  resume(sessionID: string, requestID: string): void {
    const pending = this.waiting.get(sessionID)
    if (!pending) return
    pending.delete(requestID)
    if (pending.size > 0) return
    this.waiting.delete(sessionID)
    this.acquire(sessionID)
  }

  resumeAll(sessionID: string, prefix: string): void {
    const pending = this.waiting.get(sessionID)
    if (!pending) return
    for (const requestID of pending) {
      if (requestID.startsWith(prefix)) pending.delete(requestID)
    }
    if (pending.size > 0) return
    this.waiting.delete(sessionID)
    this.acquire(sessionID)
  }

  syncWaits(sessionID: string, waits: Set<string>, prefixes: Set<string>): void {
    const pending = new Set(waits)
    const known = [...prefixes]
    for (const requestID of this.waiting.get(sessionID) ?? []) {
      if (!known.some((prefix) => requestID.startsWith(prefix))) pending.add(requestID)
    }
    if (pending.size > 0) {
      this.waiting.set(sessionID, pending)
      this.deactivate(sessionID)
      return
    }
    this.waiting.delete(sessionID)
    this.acquire(sessionID)
  }

  configure(enabled: boolean, refresh = false): void {
    if (this.enabled === enabled && !refresh) return
    this.clear()
    this.enabled = enabled
    if (!enabled || this.forced) return
    for (const sessionID of this.tasks.keys()) this.acquire(sessionID)
  }

  force(): void {
    this.forced = this.tasks.size > 0
    this.clear()
  }

  suspend(): void {
    this.clear()
  }

  reset(): void {
    this.clear()
    this.tasks.clear()
    this.waiting.clear()
    this.forced = false
  }

  ids(): string[] {
    return [...this.tasks.keys()]
  }

  directory(sessionID: string): string | undefined {
    return this.tasks.get(sessionID)?.directory
  }

  title(sessionID: string, title: string): void {
    const task = this.tasks.get(sessionID)
    if (!task || task.title === title) return
    task.title = title
    if (task.handle) this.inhibitor.update(task.handle, this.reason(title.replaceAll('"', "'")))
  }

  private acquire(sessionID: string): void {
    const task = this.tasks.get(sessionID)
    if (!task || !this.enabled || this.forced || task.handle || this.waiting.has(sessionID)) return
    const limit = this.limit()
    const remaining = limit === 0 ? undefined : limit - task.used
    if (remaining !== undefined && remaining <= 0) return

    task.handle = this.inhibitor.acquire(this.reason(task.title.replaceAll('"', "'")))
    task.started = this.now()
    if (remaining === undefined) return
    task.timer = setTimeout(() => {
      if (this.tasks.get(sessionID) !== task || !task.handle) return
      this.log(`Safety timeout reached for ${task.title}`)
      this.deactivate(sessionID)
    }, remaining)
    task.timer.unref?.()
  }

  private clear(): void {
    for (const sessionID of this.tasks.keys()) this.deactivate(sessionID)
  }

  private deactivate(sessionID: string): void {
    const task = this.tasks.get(sessionID)
    if (!task) return
    if (task.timer) clearTimeout(task.timer)
    task.timer = undefined
    if (!task.handle) return
    if (task.started !== undefined) task.used += Math.max(0, this.now() - task.started)
    this.inhibitor.release(task.handle)
    task.handle = undefined
    task.started = undefined
  }

  private limit(): number {
    const value = this.timeout()
    if (!Number.isFinite(value)) return DEFAULT_TIMEOUT * 60_000
    return Math.max(0, value)
  }
}

export class SleepInhibitorService implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("Kilo Sleep Prevention")
  private readonly bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98)
  private readonly inhibitor: SleepInhibitor
  private readonly sessions: SessionSleepInhibitor
  private readonly event: () => void
  private readonly state: () => void
  private readonly config: vscode.Disposable
  private readonly command: vscode.Disposable
  private readonly titles = new Map<string, string>()
  private readonly questions = new Map<string, QuestionTool>()
  private snapshot: Snapshot | undefined
  private lost: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly connection: KiloConnectionService) {
    this.bar.command = "kilo-code.new.allowSystemSleep"
    this.bar.text = "$(coffee) Kilo"
    this.text()
    this.inhibitor = new SleepInhibitor({
      log: (message) => this.log(message),
      active: (active) => (active ? this.bar.show() : this.bar.hide()),
    })
    this.sessions = new SessionSleepInhibitor(this.inhibitor, this.enabled(), {
      timeout: () => this.timeout(),
      reason: (title) => t("kilocode:sleep.reason", { title }),
      log: (message) => this.log(message),
    })
    this.event = connection.onEvent((event, directory) => this.handle(event, directory))
    this.state = connection.onStateChange((state) => {
      if (state === "connected") {
        this.clearLost()
        this.seed()
        return
      }
      if (state === "error" || state === "connecting") {
        this.watch()
        return
      }
      if (state === "disconnected") {
        this.clearLost()
        this.snapshot = undefined
        this.sessions.suspend()
      }
    })
    this.config = vscode.workspace.onDidChangeConfiguration((event) => {
      const enabled = event.affectsConfiguration("kilo-code.new.preventSleepDuringTasks")
      const timeout = event.affectsConfiguration("kilo-code.new.preventSleepDuringTasksTimeoutMinutes")
      const language = event.affectsConfiguration("kilo-code.new.language")
      if (language) this.text()
      if (enabled || timeout || language) this.sessions.configure(this.enabled(), timeout || language)
    })
    this.command = vscode.commands.registerCommand("kilo-code.new.allowSystemSleep", () => {
      this.sessions.force()
      this.log("System sleep inhibition was released manually")
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.snapshot = undefined
    this.event()
    this.state()
    this.clearLost()
    this.config.dispose()
    this.command.dispose()
    this.questions.clear()
    this.sessions.reset()
    this.inhibitor.dispose()
    this.bar.dispose()
    this.output.dispose()
  }

  private handle(event: SSEPayload, directory?: string): void {
    if (event.type === "session.created" || event.type === "session.updated") {
      const sessionID = event.properties.sessionID
      this.snapshot?.titles.add(sessionID)
      this.titles.set(sessionID, event.properties.info.title)
      this.sessions.title(sessionID, event.properties.info.title)
      return
    }
    if (event.type === "sync" && (event.name === "session.created.1" || event.name === "session.updated.1")) {
      const sessionID = event.data.sessionID
      this.snapshot?.titles.add(sessionID)
      this.titles.set(sessionID, event.data.info.title)
      this.sessions.title(sessionID, event.data.info.title)
      return
    }
    if (event.type === "session.status") {
      this.dirty(event.properties.sessionID)
      this.sessions.status(
        event.properties.sessionID,
        event.properties.status,
        this.titles.get(event.properties.sessionID),
        directory,
      )
      return
    }
    if (this.wait(event)) return
    if (this.tool(event)) return
    if (event.type === "session.deleted") {
      this.dirty(event.properties.sessionID)
      this.titles.delete(event.properties.sessionID)
      this.clearQuestions(event.properties.sessionID)
      this.sessions.remove(event.properties.sessionID)
      return
    }
    if (event.type === "session.idle" || event.type === "session.turn.close") {
      this.dirty(event.properties.sessionID)
      this.clearQuestions(event.properties.sessionID)
      this.sessions.remove(event.properties.sessionID)
      return
    }
    if (event.type === "sync" && event.name === "session.deleted.1") {
      this.dirty(event.data.sessionID)
      this.titles.delete(event.data.sessionID)
      this.clearQuestions(event.data.sessionID)
      this.sessions.remove(event.data.sessionID)
    }
  }

  private wait(event: SSEPayload): boolean {
    return this.question(event) || this.permission(event) || this.network(event) || this.suggestion(event)
  }

  private question(event: SSEPayload): boolean {
    if (event.type === "question.asked") {
      this.waiting(event.properties.sessionID)
      if (event.properties.blocking !== false) {
        this.sessions.pause(event.properties.sessionID, `question:${event.properties.id}`)
        remember(this.questions, event.properties)
      }
      return true
    }
    if (event.type === "question.replied" || event.type === "question.rejected") {
      this.waiting(event.properties.sessionID)
      this.questions.delete(event.properties.requestID)
      this.sessions.resume(event.properties.sessionID, `question:${event.properties.requestID}`)
      return true
    }
    if (event.type === "question.v2.asked") {
      this.waiting(event.properties.sessionID)
      this.sessions.pause(event.properties.sessionID, `question:${event.properties.id}`)
      remember(this.questions, event.properties)
      return true
    }
    if (event.type === "question.v2.replied" || event.type === "question.v2.rejected") {
      this.waiting(event.properties.sessionID)
      this.questions.delete(event.properties.requestID)
      this.sessions.resume(event.properties.sessionID, `question:${event.properties.requestID}`)
      return true
    }
    return false
  }

  private permission(event: SSEPayload): boolean {
    if (event.type === "permission.asked") {
      this.waiting(event.properties.sessionID)
      this.sessions.pause(event.properties.sessionID, `permission:${event.properties.id}`)
      return true
    }
    if (event.type === "permission.replied") {
      this.waiting(event.properties.sessionID)
      this.sessions.resume(event.properties.sessionID, `permission:${event.properties.requestID}`)
      return true
    }
    if (event.type === "permission.v2.asked") {
      this.waiting(event.properties.sessionID)
      this.sessions.pause(event.properties.sessionID, `permission:${event.properties.id}`)
      return true
    }
    if (event.type === "permission.v2.replied") {
      this.waiting(event.properties.sessionID)
      this.sessions.resume(event.properties.sessionID, `permission:${event.properties.requestID}`)
      return true
    }
    return false
  }

  private network(event: SSEPayload): boolean {
    if (event.type === "session.network.asked") {
      this.waiting(event.properties.sessionID)
      this.sessions.pause(event.properties.sessionID, `network:${event.properties.id}`)
      return true
    }
    if (
      event.type === "session.network.replied" ||
      event.type === "session.network.rejected" ||
      event.type === "session.network.restored"
    ) {
      this.waiting(event.properties.sessionID)
      this.sessions.resume(event.properties.sessionID, `network:${event.properties.requestID}`)
      return true
    }
    return false
  }

  private suggestion(event: SSEPayload): boolean {
    if (event.type === "suggestion.shown") {
      this.waiting(event.properties.sessionID)
      if (event.properties.blocking !== false) {
        this.sessions.pause(event.properties.sessionID, `suggestion:${event.properties.id}`)
      }
      return true
    }
    if (event.type === "suggestion.accepted" || event.type === "suggestion.dismissed") {
      this.waiting(event.properties.sessionID)
      this.sessions.resume(event.properties.sessionID, `suggestion:${event.properties.requestID}`)
      return true
    }
    return false
  }

  private tool(event: SSEPayload): boolean {
    const data = (() => {
      if (event.type === "message.part.updated") return event.properties
      if (event.type === "sync" && event.name === "message.part.updated.1") return event.data
      return undefined
    })()
    if (!data || data.part.type !== "tool" || data.part.tool !== "question") return false
    if (data.part.state.status === "pending" || data.part.state.status === "running") return false
    let matched = false
    for (const [requestID, tool] of this.questions) {
      if (tool.sessionID !== data.sessionID) continue
      if (tool.messageID !== data.part.messageID || tool.callID !== data.part.callID) continue
      this.waiting(data.sessionID)
      this.questions.delete(requestID)
      this.sessions.resume(data.sessionID, `question:${requestID}`)
      matched = true
    }
    return matched
  }

  private clearQuestions(sessionID: string): void {
    for (const [requestID, tool] of this.questions) {
      if (tool.sessionID === sessionID) this.questions.delete(requestID)
    }
  }

  private seed(): void {
    const dirs = this.connection.getKnownDirectories()
    if (dirs.length === 0) return
    const snapshot: Snapshot = {
      changed: new Set(),
      waits: new Set(),
      titles: new Set(),
      baseline: new Map(this.sessions.ids().map((sessionID) => [sessionID, this.sessions.directory(sessionID)])),
    }
    this.snapshot = snapshot
    void this.restore(snapshot, dirs)
  }

  private async restore(snapshot: Snapshot, dirs: string[]): Promise<void> {
    const client = this.connection.getClient()
    const [results, waits, suggestions] = await Promise.all([
      Promise.allSettled(dirs.map((directory) => client.session.status({ directory }))),
      Promise.allSettled(dirs.map((directory) => requests(client, directory))),
      Promise.allSettled([client.suggestion.list({ directory: dirs.at(0) })]),
    ])
    if (this.disposed || this.snapshot !== snapshot) return

    const restored = this.collect(results, dirs)
    const pending = this.collectWaits(waits, dirs)
    const global: Pending = new Map()
    const suggestion = suggestions.at(0)
    const error = suggestion?.status === "rejected" ? suggestion.reason : suggestion?.value.error
    if (error) this.log(`Could not restore pending suggestions: ${String(error)}`)
    const data = suggestion?.status === "fulfilled" ? suggestion.value.data : undefined
    for (const request of data ?? []) {
      if (request.blocking !== false) add(global, request.sessionID, `suggestion:${request.id}`)
    }
    const entries = [...restored.active]
    const infos = await Promise.allSettled(
      entries.map(([sessionID, item]) => client.session.get({ sessionID, directory: item.directory })),
    )
    if (this.disposed || this.snapshot !== snapshot) return
    this.names(snapshot, entries, infos)
    this.reconcile(snapshot, restored, pending, global, suggestion?.status === "fulfilled" && !error, dirs.length)
    if (this.snapshot === snapshot) this.snapshot = undefined
  }

  private collect(results: Settled<Record<string, SessionStatus>>[], dirs: string[]): Restored {
    const active: Active = new Map()
    const ok = new Set<string>()
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        this.log(`Could not restore running task status: ${String(result.reason)}`)
        continue
      }
      if (result.value.error) {
        this.log(`Could not restore running task status: ${String(result.value.error)}`)
        continue
      }
      const directory = dirs.at(index)
      if (!directory) continue
      ok.add(directory)
      for (const [sessionID, status] of Object.entries(result.value.data ?? {})) {
        active.set(sessionID, { directory, status })
      }
    }
    return { active, ok }
  }

  private collectWaits(results: PromiseSettledResult<Requests>[], dirs: string[]): Map<string, Requests> {
    const pending = new Map<string, Requests>()
    for (const [index, result] of results.entries()) {
      const directory = dirs.at(index)
      if (!directory) continue
      if (result.status === "rejected") {
        this.log(`Could not restore pending task input for ${directory}: ${String(result.reason)}`)
        continue
      }
      for (const error of result.value.errors) {
        this.log(`Could not completely restore pending task input for ${directory}: ${String(error)}`)
      }
      pending.set(directory, result.value)
    }
    return pending
  }

  private names(
    snapshot: Snapshot,
    entries: Array<[string, { directory: string; status: SessionStatus }]>,
    infos: Settled<{ title: string }>[],
  ): void {
    for (const [index, result] of infos.entries()) {
      const sessionID = entries.at(index)?.[0]
      if (!sessionID || snapshot.titles.has(sessionID)) continue
      if (result.status === "rejected") {
        this.log(`Could not restore running task title: ${String(result.reason)}`)
        continue
      }
      if (result.value.error || !result.value.data) {
        if (result.value.error) this.log(`Could not restore running task title: ${String(result.value.error)}`)
        continue
      }
      this.titles.set(sessionID, result.value.data.title)
      this.sessions.title(sessionID, result.value.data.title)
    }
  }

  private reconcile(
    snapshot: Snapshot,
    restored: Restored,
    pending: Map<string, Requests>,
    global: Pending,
    suggestions: boolean,
    total: number,
  ): void {
    for (const [sessionID, item] of restored.active) {
      this.syncPending(snapshot, sessionID, item.directory, pending, global, suggestions)
      if (snapshot.changed.has(sessionID)) continue
      this.sessions.status(sessionID, item.status, this.titles.get(sessionID), item.directory)
    }
    for (const [sessionID, directory] of snapshot.baseline) {
      if (restored.active.has(sessionID) || snapshot.changed.has(sessionID)) continue
      const complete = directory ? restored.ok.has(directory) : restored.ok.size === total
      if (!complete) continue
      this.titles.delete(sessionID)
      this.clearQuestions(sessionID)
      this.sessions.remove(sessionID)
    }
  }

  private syncPending(
    snapshot: Snapshot,
    sessionID: string,
    directory: string,
    pending: Map<string, Requests>,
    global: Pending,
    suggestions: boolean,
  ): void {
    if (snapshot.waits.has(sessionID)) return
    const local = pending.get(directory)
    if (!local && !suggestions) return
    const waits = new Set(local?.pending.get(sessionID) ?? [])
    const prefixes = new Set(local?.prefixes ?? [])
    if (suggestions) {
      prefixes.add("suggestion:")
      for (const requestID of global.get(sessionID) ?? []) waits.add(requestID)
    }
    if (prefixes.size > 0) this.sessions.syncWaits(sessionID, waits, prefixes)
    if (local?.prefixes.has("question:")) this.syncQuestions(sessionID, local.tools)
  }

  private dirty(sessionID: string): void {
    this.snapshot?.changed.add(sessionID)
  }

  private waiting(sessionID: string): void {
    this.snapshot?.waits.add(sessionID)
  }

  private syncQuestions(sessionID: string, tools: Map<string, QuestionTool>): void {
    this.clearQuestions(sessionID)
    for (const [requestID, tool] of tools) {
      if (tool.sessionID === sessionID) this.questions.set(requestID, tool)
    }
  }

  private watch(): void {
    if (this.lost) return
    this.lost = setTimeout(() => {
      this.lost = undefined
      this.snapshot = undefined
      this.sessions.suspend()
      this.log("Connection remained unavailable; system sleep inhibition was suspended")
    }, CONNECTION_GRACE)
    this.lost.unref?.()
  }

  private clearLost(): void {
    if (!this.lost) return
    clearTimeout(this.lost)
    this.lost = undefined
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration("kilo-code.new").get("preventSleepDuringTasks", false)
  }

  private timeout(): number {
    const value = vscode.workspace
      .getConfiguration("kilo-code.new")
      .get("preventSleepDuringTasksTimeoutMinutes", DEFAULT_TIMEOUT)
    const minutes = Number.isFinite(value) ? Math.max(0, value) : DEFAULT_TIMEOUT
    return minutes * 60_000
  }

  private text(): void {
    this.bar.tooltip = t("kilocode:sleep.statusBar.tooltip")
  }

  private log(message: string): void {
    this.output.appendLine(`[Kilo New] [${new Date().toISOString()}] ${message}`)
  }
}
