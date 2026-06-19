import { createKiloClient, type Config as EffectiveConfig } from "@kilocode/sdk/v2/client"
import type {
  AgentBuilderPreviewResponse,
  AgentBuilderSaveResponse,
  Auth,
  AppAgentsResponse,
  ConfigOverlayResponse,
  ConfigModelStateResponse,
  ConfigSourcesResponse,
  FormatterStatusResponse,
  GlobalHealthResponse,
  GlobalEvent,
  KiloEmbeddingModelCatalog,
  KiloProfileResponse,
  LspStatusResponse,
  McpStatusResponse,
  Pty as PtyInfo,
  PermissionRequest,
  Project as KiloProject,
  QuestionRequest,
  ProviderAuthAuthorization,
  ProviderAuthResponse,
  ProviderListResponse,
  Session as KiloSession,
  SessionStatus,
  ToolIdsResponse,
  ToolListResponse,
  TuiConfigGetResponse,
  TuiKeybindListResponse,
  VcsInfo,
  Worktree,
  WorktreeDiffItem,
  WorktreeListResponse,
} from "@kilocode/sdk/v2/client"

export type Scope = "global" | "project"

export type Query = {
  url: string
  dir: string
  scope: Scope
}

export type ProjectQuery = Pick<Query, "url" | "dir">

export type KiloProfileData = KiloProfileResponse

export type ProjectItem = KiloProject
export type RecentProjectItem = ProjectItem & {
  sessions: number
}

export type ProjectConsoleQuery = ProjectQuery & {
  project: string
}

export type ProjectConsoleSnapshot = {
  project: ProjectItem
  config: EffectiveConfig
  vcs: VcsInfo
  worktrees: WorktreeListResponse
  terminals: ProjectTerminalItem[]
}

export type ProjectWorktreeItem = Worktree
export type ProjectDiffItem = WorktreeDiffItem
export type ProjectPtyInfo = PtyInfo
export type ProjectTerminalItem = ProjectPtyInfo & {
  directory: string
  session?: KiloSession
  sessionStatus?: SessionStatus
  attention?: "permission" | "question"
}
export type ProjectConsoleEvent = GlobalEvent

export type Snapshot = {
  health: GlobalHealthResponse
  effective: EffectiveConfig
  overlay: ConfigOverlayResponse
  sources: ConfigSourcesResponse
  modelState: ConfigModelStateResponse
  providers: ProviderListResponse
  authMethods: ProviderAuthResponse
  tui: TuiConfigGetResponse
  keybinds: TuiKeybindListResponse
  tools: ToolIdsResponse
  toolDetails: ToolListResponse
  mcp: McpStatusResponse
  lsp: LspStatusResponse
  formatter: FormatterStatusResponse
  agents: AppAgentsResponse
}

export type ConfigPatch = Partial<EffectiveConfig>

export type ConfigUnset = string[][]
export type ModelRef = ConfigModelStateResponse["favorite"][number]

export type TuiPatch = Partial<TuiConfigGetResponse>

export type AgentPayload = {
  scope: Scope
  id: string
  description?: string
  mode: "primary" | "subagent" | "all"
  model?: string
  color?: string
  steps?: number
  tools?: string[]
  permission?: Record<string, unknown>
  prompt: string
}

type Result<T> = {
  data: T | undefined
  error?: unknown
}

type Hit = {
  url: string
  count: number
  time: number
}

const ports = Array.from({ length: 20 }, (_, index) => 4097 + index)
const day = 24 * 60 * 60 * 1000
const key = "kilo.config.server"
const discovery: { run?: Promise<string | undefined> } = {}

const fetcher = window.fetch.bind(window) as typeof fetch

function encode(input: string) {
  const bytes = new TextEncoder().encode(input)
  return btoa(String.fromCharCode(...bytes))
}

function decode(input: string) {
  if (!input) return ""
  return decodeURIComponent(input)
}

function server(input: string) {
  const url = new URL(input)
  const user = decode(url.username) || "kilo"
  const pass = decode(url.password) || "kilo"
  url.username = ""
  url.password = ""
  url.search = ""
  url.hash = ""
  return {
    url: url.toString().replace(/\/$/, ""),
    token: encode(`${user}:${pass}`),
  }
}

function client(input: ProjectQuery) {
  const info = server(input.url)
  return createKiloClient({
    baseUrl: info.url,
    directory: value(input.dir),
    headers: {
      Authorization: `Basic ${info.token}`,
    },
    fetch: fetcher,
  })
}

function value(input: string) {
  const trimmed = input.trim()
  if (trimmed) return trimmed
  return undefined
}

function message(input: unknown) {
  if (input instanceof Error) return input.message
  if (typeof input === "string") return input
  if (input === undefined || input === null) return "Unknown error"
  return JSON.stringify(input)
}

function demand<T>(label: string, result: Result<T>) {
  if (result.error) throw new Error(`${label}: ${message(result.error)}`)
  if (result.data === undefined) throw new Error(`${label}: empty response`)
  return result.data
}

async function resolved(input: ProjectConsoleQuery) {
  const items = await loadVisibleProjects(input)
  const item = items.find((row) => row.id === input.project)
  if (!item) throw new Error(`Project not found: ${input.project}`)
  return item
}

async function maybe<T>(label: string, result: Promise<Result<T>>) {
  return await result
    .then((value) => {
      if (value.error) {
        console.warn(`${label}: ${message(value.error)}`)
        return undefined
      }
      return value.data
    })
    .catch((err) => {
      console.warn(`${label}: ${message(err)}`)
      return undefined
    })
}

function model(input: unknown) {
  if (typeof input !== "string") return undefined
  const index = input.indexOf("/")
  if (index <= 0 || index >= input.length - 1) return undefined
  return { provider: input.slice(0, index), model: input.slice(index + 1) }
}

function directory(input: ProjectQuery) {
  const dir = value(input.dir)
  return dir ? { directory: dir } : undefined
}

function title(input: string) {
  return input
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function fallback(input: TuiConfigGetResponse): TuiKeybindListResponse {
  return {
    keybinds: Object.entries(input.keybinds ?? {}).map(([id, binding]) => ({
      id,
      label: title(id),
      group: "Configured",
      default: binding ?? "none",
      description: "Configured TUI keybind",
    })),
  }
}

function norm(input: string) {
  const text = input.replace(/\\/g, "/").replace(/\/+$/, "")
  return text || "/"
}

function inside(root: string, input: string) {
  const base = norm(root)
  const dir = norm(input)
  if (dir === base) return true
  return dir.startsWith(`${base}/`)
}

function visible(item: ProjectItem) {
  if (item.id !== "global") return true
  return norm(item.worktree) !== "/"
}

function score(item: ProjectItem, dir: string) {
  return [item.worktree, ...item.sandboxes].reduce((best, root) => {
    if (!inside(root, dir)) return best
    return Math.max(best, norm(root).length)
  }, -1)
}

function owner(items: ProjectItem[], session: Pick<KiloSession, "projectID" | "directory">) {
  const exact = items.find((item) => item.id === session.projectID)
  if (exact) return exact
  return items.reduce<{ item?: ProjectItem; score: number }>(
    (best, item) => {
      const next = score(item, session.directory)
      if (next <= best.score) return best
      return { item, score: next }
    },
    { score: -1 },
  ).item
}

async function probe(url: string) {
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), 400)
  const info = server(url)
  return await fetcher(`${info.url}/global/health`, {
    headers: { Authorization: `Basic ${info.token}` },
    signal: ctl.signal,
  })
    .then((res) => (res.ok ? url : undefined))
    .catch(() => undefined)
    .finally(() => window.clearTimeout(timer))
}

function projects(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is ProjectItem => {
    if (!item || typeof item !== "object") return false
    const row = item as Partial<ProjectItem>
    return typeof row.id === "string" && typeof row.worktree === "string" && typeof row.time?.updated === "number"
  })
}

function newest(items: ProjectItem[]) {
  return items.reduce((best, item) => Math.max(best, item.time.updated), 0)
}

async function inspect(url: string): Promise<Hit | undefined> {
  const hit = await probe(url)
  if (!hit) return undefined

  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), 400)
  const info = server(url)
  return await fetcher(`${info.url}/project`, { headers: { Authorization: `Basic ${info.token}` }, signal: ctl.signal })
    .then(async (res) => {
      if (!res.ok) return { url, count: 0, time: 0 }
      const rows = projects(await res.json()).filter(visible)
      return { url, count: rows.length, time: newest(rows) }
    })
    .catch(() => ({ url, count: 0, time: 0 }))
    .finally(() => window.clearTimeout(timer))
}

function port(input: string) {
  return Number(new URL(input).port) || 0
}

function local(input: string) {
  return new URL(input).hostname === "127.0.0.1" ? 1 : 0
}

export function loadCached() {
  return window.localStorage.getItem(key) ?? ""
}

export function saveCached(url: string) {
  window.localStorage.setItem(key, url)
}

export function forgetCached() {
  window.localStorage.removeItem(key)
}

export async function healthy(url: string) {
  return (await probe(url)) !== undefined
}

async function scan() {
  const urls = ports.flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  const hits = (await Promise.all(urls.map(inspect))).filter((item): item is Hit => item !== undefined)
  return hits.toSorted(
    (a, b) => b.count - a.count || b.time - a.time || port(b.url) - port(a.url) || local(b.url) - local(a.url),
  )[0]?.url
}

export async function discover() {
  if (discovery.run) return await discovery.run
  const run = scan().finally(() => {
    if (discovery.run === run) discovery.run = undefined
  })
  discovery.run = run
  return await run
}

export async function resolveServer() {
  const hit = await discover()
  if (hit) return hit

  const cached = loadCached()
  if (!cached) return undefined
  if (await healthy(cached)) return cached
  forgetCached()
  return undefined
}

export async function load(input: Query): Promise<Snapshot> {
  const sdk = client(input)
  const [health, overlay, modelState, providers, authMethods, tui, keybinds, tools, mcp, lsp, formatter, agents] =
    await Promise.all([
      sdk.global.health(),
      sdk.config.overlay({ scope: input.scope }),
      sdk.config.modelState(),
      sdk.provider.list(),
      sdk.provider.auth(),
      sdk.tui.config.get(),
      maybe("TUI keybinds", sdk.tui.keybind.list()),
      sdk.tool.ids(),
      sdk.mcp.status(),
      sdk.lsp.status(),
      sdk.formatter.status(),
      sdk.app.agents(),
    ])
  const resolved = demand("Config overlay", overlay)
  const ref = model(resolved.effective.model)
  const info = ref ? await maybe("Tool metadata", sdk.tool.list(ref)) : undefined
  const cfg = demand("TUI config", tui)

  return {
    health: demand("Health", health),
    effective: resolved.effective,
    overlay: resolved,
    sources: { sources: resolved.sources },
    modelState: demand("Model state", modelState),
    providers: demand("Providers", providers),
    authMethods: demand("Provider auth methods", authMethods),
    tui: cfg,
    keybinds: keybinds ?? fallback(cfg),
    tools: demand("Tools", tools),
    toolDetails: info ?? [],
    mcp: demand("MCP status", mcp),
    lsp: demand("LSP status", lsp),
    formatter: demand("Formatter status", formatter),
    agents: demand("Agents", agents),
  }
}

export async function loadEmbeddingModels(input: Query): Promise<KiloEmbeddingModelCatalog> {
  return demand("Kilo embedding models", await client(input).indexing.models())
}

export async function loadKiloProfile(input: ProjectQuery): Promise<KiloProfileData> {
  const sdk = client(input)
  const result = await sdk.kilo.profile(directory(input))
  return demand("Kilo profile", result)
}

export async function setKiloOrganization(input: ProjectQuery, organizationId: string | null) {
  const sdk = client(input)
  const result = await sdk.kilo.organization.set({ ...directory(input), organizationId })
  demand("Switch Kilo account", result)
  await sdk.global.dispose()
}

export async function logoutKilo(input: ProjectQuery) {
  const sdk = client(input)
  const result = await sdk.auth.remove({ providerID: "kilo" })
  demand("Log out of Kilo", result)
  await sdk.global.dispose()
}

export async function startKiloLogin(input: ProjectQuery): Promise<ProviderAuthAuthorization> {
  const sdk = client(input)
  const result = await sdk.provider.oauth.authorize({ ...directory(input), providerID: "kilo", method: 0 })
  return demand("Start Kilo login", result)
}

export async function completeKiloLogin(input: ProjectQuery, signal?: AbortSignal) {
  const sdk = client(input)
  const result = await sdk.provider.oauth.callback(
    { ...directory(input), providerID: "kilo", method: 0 },
    signal ? { signal } : undefined,
  )
  demand("Complete Kilo login", result)
  await sdk.global.dispose()
}

export async function loadProjects(input: ProjectQuery): Promise<ProjectItem[]> {
  const sdk = client(input)
  const dir = value(input.dir)
  const result = await sdk.project.list(dir ? { directory: dir } : undefined)
  return demand("Projects", result)
}

export async function loadVisibleProjects(input: ProjectQuery): Promise<ProjectItem[]> {
  const items = await loadProjects(input)
  return items.filter(visible)
}

export async function loadRecentProjects(input: ProjectQuery): Promise<RecentProjectItem[]> {
  const sdk = client(input)
  const [items, sessions] = await Promise.all([
    loadVisibleProjects(input),
    sdk.experimental.session.list({ archived: false, start: Date.now() - day, limit: 500 }),
  ])
  const rows = demand("Recent sessions", sessions)
  const counts = new Map<string, number>()

  for (const row of rows) {
    const item = owner(items, row)
    if (!item) continue
    counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
  }

  return items.map((item) => ({ ...item, sessions: counts.get(item.id) ?? 0 })).filter((item) => item.sessions > 0)
}

export async function loadProjectConsole(input: ProjectConsoleQuery): Promise<ProjectConsoleSnapshot> {
  const project = await resolved(input)
  const query = { url: input.url, dir: project.worktree }
  const sdk = client(query)
  const [config, vcs, worktrees] = await Promise.all([
    sdk.config.overlay({ scope: "global" }),
    sdk.vcs.get({ directory: query.dir }),
    sdk.worktree.list({ directory: query.dir }),
  ])
  const overlay = demand("Config", config)
  const dirs = demand("Worktrees", worktrees)
  const terminals = await Promise.all(
    [query.dir, ...dirs.map((item) => item.directory)].map((dir) => loadProjectTerminals({ url: input.url, dir }, dir)),
  )

  return {
    project,
    config: overlay.global,
    vcs: demand("VCS", vcs),
    worktrees: dirs,
    terminals: terminals.flat(),
  }
}

export async function createProjectWorktree(input: Query, name?: string): Promise<ProjectWorktreeItem> {
  const sdk = client(input)
  const trimmed = name?.trim()
  const result = await sdk.worktree.create({
    directory: input.dir,
    ...(trimmed ? { worktreeCreateInput: { name: trimmed } } : {}),
  })
  return demand("Create worktree", result)
}

export async function removeProjectWorktree(input: Query, dir: string) {
  const sdk = client(input)
  const result = await sdk.worktree.remove({ directory: input.dir, worktreeRemoveInput: { directory: dir } })
  return demand("Remove worktree", result)
}

export async function resetProjectWorktree(input: Query, dir: string) {
  const sdk = client(input)
  const result = await sdk.worktree.reset({ directory: input.dir, worktreeResetInput: { directory: dir } })
  return demand("Reset worktree", result)
}

export async function loadProjectTerminals(input: ProjectQuery, dir: string): Promise<ProjectTerminalItem[]> {
  const sdk = client({ url: input.url, dir })
  const [result, statusResult, permissionResult, questionResult] = await Promise.all([
    sdk.pty.list({ directory: dir }),
    maybe("Session status", sdk.session.status({ directory: dir })),
    maybe("Pending permissions", sdk.permission.list({ directory: dir })),
    maybe("Pending questions", sdk.question.list({ directory: dir })),
  ])
  const rows = demand("Terminals", result)
  const status = statusResult ?? {}
  const permissions = pending(permissionResult ?? [])
  const questions = pending(questionResult ?? [])
  const sessions = new Map<string, KiloSession>()

  await Promise.all(
    rows.map(async (item) => {
      if (!item.sessionID || sessions.has(item.sessionID)) return
      const session = await maybe("Session", sdk.session.get({ directory: dir, sessionID: item.sessionID }))
      if (session) sessions.set(item.sessionID, session)
    }),
  )

  return rows.map((item) => {
    const session = item.sessionID ? sessions.get(item.sessionID) : undefined
    return {
      ...item,
      directory: dir,
      session,
      sessionStatus: item.sessionID ? status[item.sessionID] : undefined,
      attention: item.sessionID ? attention(item.sessionID, permissions, questions) : undefined,
    }
  })
}

function opened(items: ProjectPtyInfo[]) {
  return new Set(items.flatMap((item) => (item.sessionID ? [item.sessionID] : [])))
}

function pending(items: Array<PermissionRequest | QuestionRequest>) {
  return new Set(items.map((item) => item.sessionID))
}

function requested(items: Array<PermissionRequest | QuestionRequest>, open: Set<string>) {
  return items.some((item) => open.has(item.sessionID))
}

export type ProjectLiveStatus = {
  busy: boolean
  attention: boolean
}

export async function loadProjectLiveStatus(input: ProjectQuery, dir: string): Promise<ProjectLiveStatus> {
  const sdk = client({ url: input.url, dir })
  const [status, terminals, permissions, questions] = await Promise.all([
    maybe("Session status", sdk.session.status({ directory: dir })),
    maybe("Terminals", sdk.pty.list({ directory: dir })),
    maybe("Pending permissions", sdk.permission.list({ directory: dir })),
    maybe("Pending questions", sdk.question.list({ directory: dir })),
  ])
  const open = opened(terminals ?? [])
  const busy = Object.entries(status ?? {}).some(([id, s]) => open.has(id) && s.type !== "idle")
  const attention = requested(permissions ?? [], open) || requested(questions ?? [], open)
  return { busy, attention }
}

export async function loadProjectOpenSessions(input: ProjectQuery, dir: string) {
  const sdk = client({ url: input.url, dir })
  const terminals = await maybe("Terminals", sdk.pty.list({ directory: dir }))
  return opened(terminals ?? [])
}

function attention(id: string, permissions: Set<string>, questions: Set<string>) {
  if (permissions.has(id)) return "permission"
  if (questions.has(id)) return "question"
  return undefined
}

export async function loadProjectDiff(input: Query, dir: string): Promise<ProjectDiffItem[]> {
  const sdk = client({ url: input.url, dir })
  const result = await sdk.worktree.diffSummary({ directory: dir })
  return demand("Worktree diff", result)
}

export async function loadProjectDiffFile(input: Query, dir: string, file: string): Promise<ProjectDiffItem | null> {
  const sdk = client({ url: input.url, dir })
  const result = await sdk.worktree.diffFile({ directory: dir, file })
  return demand("Worktree diff file", result)
}

export async function createProjectPty(input: Query, dir: string, title = "Kilo session"): Promise<ProjectPtyInfo> {
  const sdk = client({ url: input.url, dir })
  const result = await sdk.pty.create({ directory: dir, command: "kilo", cwd: dir, title })
  return demand("Create terminal", result)
}

export async function removeProjectPty(input: Query, pty: string) {
  const sdk = client({ url: input.url, dir: input.dir })
  const result = await sdk.pty.remove({ directory: input.dir, ptyID: pty })
  return demand("Remove terminal", result)
}

export async function viewProjectSessions(input: ProjectQuery, focused: string[], open: string[]) {
  const sdk = client(input)
  const result = await sdk.session.viewed({ directory: input.dir, focused, open })
  return demand("Viewed sessions", result)
}

export function subscribeProjectEvents(input: ProjectQuery, handler: (event: ProjectConsoleEvent) => void) {
  const sdk = client(input)
  const ctl = new AbortController()
  void (async () => {
    const events = await sdk.global.event({ signal: ctl.signal, sseMaxRetryAttempts: 0 })
    for await (const event of events.stream) {
      if (ctl.signal.aborted) return
      handler(event)
    }
  })().catch((err) => {
    if (!ctl.signal.aborted) console.warn(`Project events: ${message(err)}`)
  })
  return () => ctl.abort()
}

export async function resizeProjectPty(input: Query, pty: string, cols: number, rows: number) {
  const sdk = client({ url: input.url, dir: input.dir })
  const result = await sdk.pty.update({ directory: input.dir, ptyID: pty, size: { cols, rows } })
  return demand("Resize terminal", result)
}

export function ptyWsUrl(input: Query, pty: string, cursor = 0) {
  const info = server(input.url)
  const url = new URL(`/pty/${encodeURIComponent(pty)}/connect`, info.url)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("directory", input.dir)
  url.searchParams.set("cursor", String(cursor))
  url.searchParams.set("auth_token", info.token)
  return url.toString()
}

export async function patchConfig(input: Query, patch: Partial<ConfigPatch>, unset?: ConfigUnset) {
  const sdk = client(input)
  const set = Object.keys(patch).length ? patch : undefined
  const result = await sdk.config.overlayUpdate({
    directory: value(input.dir),
    scope: input.scope,
    set,
    unset,
  })
  return demand("Update config", result)
}

export async function saveConfig(input: Query, patch: Partial<ConfigPatch>) {
  return patchConfig(input, patch)
}

export async function unsetConfig(input: Query, unset: ConfigUnset) {
  return patchConfig(input, {}, unset)
}

export async function saveModelState(input: Query, favorite: ModelRef[]) {
  const sdk = client(input)
  const result = await sdk.config.modelStateUpdate({ favorite })
  return demand("Update model state", result)
}

export async function connectProvider(input: Query, id: string, key: string, metadata?: Record<string, string>) {
  const sdk = client(input)
  const auth: Auth = metadata ? { type: "api", key, metadata } : { type: "api", key }
  const result = await sdk.auth.set({ providerID: id, auth })
  demand("Connect provider", result)
  await sdk.global.dispose()
}

export async function authorizeProvider(
  input: Query,
  id: string,
  method: number,
  inputs?: Record<string, string>,
): Promise<ProviderAuthAuthorization> {
  const sdk = client(input)
  const result = await sdk.provider.oauth.authorize({ providerID: id, method, inputs })
  return demand("Authorize provider", result)
}

export async function completeProvider(input: Query, id: string, method: number, code?: string) {
  const sdk = client(input)
  const result = await sdk.provider.oauth.callback({ providerID: id, method, code })
  demand("Complete provider authorization", result)
  await sdk.global.dispose()
}

export async function connectMcp(input: Query, name: string) {
  const sdk = client(input)
  const result = await sdk.mcp.connect({ name })
  return demand("Connect MCP server", result)
}

export async function disconnectMcp(input: Query, name: string) {
  const sdk = client(input)
  const result = await sdk.mcp.disconnect({ name })
  return demand("Disconnect MCP server", result)
}

export async function authenticateMcp(input: Query, name: string) {
  const sdk = client(input)
  const result = await sdk.mcp.auth.authenticate({ name })
  return demand("Authenticate MCP server", result)
}

export async function saveTui(input: Query, patch: TuiPatch) {
  const sdk = client(input)
  const result = await sdk.tui.config.update({ scope: input.scope, ...patch })
  return demand("Update TUI config", result)
}

export async function previewAgent(input: Query, payload: AgentPayload): Promise<AgentBuilderPreviewResponse> {
  const sdk = client(input)
  const result = await sdk.agentBuilder.preview(payload)
  return demand("Preview agent", result)
}

export async function saveAgent(input: Query, payload: AgentPayload): Promise<AgentBuilderSaveResponse> {
  const sdk = client(input)
  const result = await sdk.agentBuilder.save({
    path_id: payload.id,
    scope: payload.scope,
    description: payload.description,
    mode: payload.mode,
    model: payload.model,
    color: payload.color,
    steps: payload.steps,
    tools: payload.tools,
    permission: payload.permission,
    prompt: payload.prompt,
  })
  return demand("Save agent", result)
}
