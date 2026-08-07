export type Envelope<T = unknown> = {
  ok: boolean
  tool: "browser" | "config" | "computer"
  verb: string
  session?: string
  duration_ms: number
  data?: T
  warnings: string[]
  errors: string[]
  reason?: string
}

export type BrowserCapability = {
  headless: boolean
  display?: string
  chromiumReady: boolean
  chromiumVersion?: string
  installation: {
    state: "available" | "missing"
    message?: string
  }
}

export type SessionInfo = {
  name: string
  createdAt: number
  lastUsedAt: number
  lastUrl?: string
}

export type BrowserStatus = {
  sessions: SessionInfo[]
  capability: BrowserCapability
  chromiumPid: number | null
}

export type TabInfo = {
  index: number
  url: string
  title?: string
  active: boolean
}

export type CookieEntry = {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: "Strict" | "Lax" | "None"
}

export type RefEntry = {
  ref: string
  role: string
  name: string
  selector?: string
  depth: number
}

export type Snapshot = {
  snapshot: string
  refs: RefEntry[]
}

export type BrowserConfig = {
  headless: boolean
  antiDetect: boolean
  timeoutMs: number
  viewport: { width: number; height: number }
  executablePath?: string
  useSystemChrome?: boolean
  args: string[]
}

export type WorldConfig = {
  browser: BrowserConfig
  home: string
}

export type WorldConfigPatch = Omit<Partial<WorldConfig>, "browser"> & {
  browser?: Partial<BrowserConfig>
}

export type DaemonConfig = {
  browser?: Pick<
    BrowserConfig,
    "headless" | "antiDetect" | "timeoutMs" | "viewport" | "executablePath" | "useSystemChrome" | "args"
  >
}

export type Action = {
  verb: string
  args: string[]
  directory?: string
  paths?: string[]
  config?: DaemonConfig
}

export type RunOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  directory?: string
  paths?: string[]
  config?: WorldConfig
}

export type RunResult = {
  ok: boolean
  durationMs: number
  results: ActionResult[]
}

export type ActionResult = {
  ok: boolean
  verb: string
  args: string[]
  data?: unknown
  error?: string
  durationMs: number
  screenshot?: { path: string; bytes: number; mime: string }
  refs?: Array<{ ref: string; role: string; name: string; selector?: string }>
}
