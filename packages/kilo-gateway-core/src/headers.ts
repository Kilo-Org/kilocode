export * as KiloHeaders from "./headers.js"

export const HEADER_ORGANIZATION = "X-KILOCODE-ORGANIZATIONID"
export const HEADER_EDITOR = "X-KILOCODE-EDITORNAME"
export const HEADER_FEATURE = "X-KILOCODE-FEATURE"
export const HEADER_TASK = "X-KILOCODE-TASKID"
export const HEADER_PARENT_TASK = "X-KILOCODE-PARENT-TASKID"
export const HEADER_PROJECT = "X-KILOCODE-PROJECTID"
export const HEADER_MACHINE = "X-KILOCODE-MACHINEID"
export const HEADER_TESTER = "X-KILOCODE-TESTER"
export const HEADER_MODE = "x-kilocode-mode"
export const USER_AGENT_PREFIX = "opencode-kilo-provider"
export const TESTER_SUPPRESS_VALUE = "SUPPRESS"

export interface Options {
  readonly version: string
  readonly organizationID?: string | null
  readonly testerWarningsDisabledUntil?: number
  // The client product of the root session (v1 `platform`), for example "vscode". See `feature` below.
  readonly platform?: string
}

export interface RequestOptions extends Options {
  readonly sessionID?: string
  readonly parentSessionID?: string
  readonly projectID?: string
  readonly machineID?: string
  readonly mode?: string
}

// Provider-level attribution headers from v1 (`packages/opencode/src/kilocode/const.ts` and
// `packages/kilo-gateway/src/headers.ts`).
export function provider(options: Options, env: Record<string, string | undefined> = process.env): Record<string, string> {
  const version = env.KILOCODE_VERSION || options.version
  const testerUntil =
    options.testerWarningsDisabledUntil ??
    (env.KILO_TESTER_WARNINGS_DISABLED_UNTIL ? Number(env.KILO_TESTER_WARNINGS_DISABLED_UNTIL) : undefined)
  return {
    "HTTP-Referer": "https://kilocode.ai",
    "X-Title": "Kilo Code",
    [HEADER_EDITOR]: env.KILOCODE_EDITOR_NAME || `Kilo CLI ${version}`,
    [HEADER_FEATURE]: feature(options.platform, env),
    ...(options.organizationID ? { [HEADER_ORGANIZATION]: options.organizationID } : {}),
    ...(env.KILO_TESTER === TESTER_SUPPRESS_VALUE || (testerUntil && testerUntil > Date.now())
      ? { [HEADER_TESTER]: TESTER_SUPPRESS_VALUE }
      : {}),
  }
}

// Per-request attribution headers from v1 (`packages/opencode/src/session/llm/request.ts` and
// `packages/kilo-gateway/src/headers.ts`).
export function request(
  options: RequestOptions,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const version = env.KILOCODE_VERSION || options.version
  return {
    ...provider(options, env),
    "User-Agent": version ? `${USER_AGENT_PREFIX}/${version}` : USER_AGENT_PREFIX,
    ...(options.sessionID ? { [HEADER_TASK]: options.sessionID } : {}),
    ...(options.parentSessionID ? { [HEADER_PARENT_TASK]: options.parentSessionID } : {}),
    ...(options.projectID ? { [HEADER_PROJECT]: options.projectID } : {}),
    ...(options.machineID ? { [HEADER_MACHINE]: options.machineID } : {}),
    ...(options.mode ? { [HEADER_MODE]: options.mode.toLowerCase() } : {}),
  }
}

// v1 `KiloSession.featureForPlatform` and `attribution`: the root session platform, else the process platform, maps
// to a feature. Unknown platforms fall back to the process feature, then to "cli".
function feature(platform: string | undefined, env: Record<string, string | undefined>) {
  return FEATURES.get(platform ?? env.KILO_PLATFORM ?? "") ?? (env.KILOCODE_FEATURE || "cli")
}

const FEATURES = new Map([
  ["agent-manager", "agent-manager"],
  ["vscode", "vscode-extension"],
  ["cli", "cli"],
])
