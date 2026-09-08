export interface BrowserScope {
  sessionId: string
  projectId?: string
}

export interface BrowserPosition {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserElement {
  tag: string
  id?: string
  classes?: string
  text?: string
  selector?: string
  rect?: { x: number; y: number; width: number; height: number }
  hierarchy?: string[]
  html?: string
  styles?: { color?: string; backgroundColor?: string }
  source?: { file: string; line?: number; column?: number }
}

export interface BrowserState {
  scope: BrowserScope
  browserId: string
  navigation?: number
  status: "starting" | "ready" | "loading" | "error" | "closed"
  inspecting?: boolean
  url?: string
  title?: string
  errors: number
  logs?: string[]
  error?: string
  frameError?: string
}

export interface BrowserInspection {
  scope: BrowserScope
  requestId: string
  url?: string
  title?: string
  element?: BrowserElement
  logs: string[]
  hover?: boolean
  error?: string
}

export interface BrowserDevtools {
  scope: BrowserScope
  browserId: string
  url: string
}

export type BrowserCommand =
  | { type: "open"; scope: BrowserScope; url: string }
  | { type: "refresh"; scope: BrowserScope }
  | { type: "close"; scope: BrowserScope }
  | { type: "state"; scope: BrowserScope }
  | { type: "inspect"; scope: BrowserScope; position: BrowserPosition; hover: boolean; requestId: string }
  | { type: "input"; scope: BrowserScope; position: BrowserPosition; click: boolean }
  | { type: "devtools"; scope: BrowserScope; theme: "dark" | "light" }

export type BrowserEvent =
  | { type: "state"; value: BrowserState }
  | { type: "inspection"; value: BrowserInspection }
  | { type: "devtools"; value: BrowserDevtools }

export interface BrowserTransport {
  send(command: BrowserCommand): void
  subscribe(listener: (event: BrowserEvent) => void): () => void
}

export interface BrowserLabels {
  title: string
  url: string
  urlPlaceholder: string
  open: string
  refresh: string
  close: string
  inspect: string
  devtoolsTitle: string
  diagnostics: string
  diagnosticsHint: string
  empty: string
  noSession: string
  screenshotAlt: string
  errors: (count: number) => string
}
