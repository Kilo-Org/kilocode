/**
 * Classifies a failed nono launch from the stderr it leaves behind. nono prints session diagnostics as JSON only
 * when `--diagnostics-json` is requested (the sandbox launches pass `--silent`, which also suppresses the footer),
 * so this falls back to the raw stderr and never invents a reason the output does not state.
 *
 * Upstream caveats: denial records are incomplete for some syscalls (#1796, #2209) and silent for non-admin macOS
 * users (#1431). Treat `unknown` as a real answer.
 */
export type DenialKind = "denied-path" | "denied-network" | "denied-socket" | "not-found" | "application" | "unknown"

export interface Diagnostics {
  readonly kind: DenialKind
  /** The nono diagnostic codes (or none when classified from raw stderr). */
  readonly codes: ReadonlyArray<string>
  /** Paths nono named in a denial, deduplicated. */
  readonly paths: ReadonlyArray<string>
  /** The exit code: nono's preserved child status, or the caller's code when the block omits it. */
  readonly exit: number
  /** The matched output, with caller-supplied secrets removed. */
  readonly text: string
}

interface Session {
  readonly exit_code?: unknown
  readonly denials?: ReadonlyArray<{ readonly path?: unknown }>
  readonly violations?: ReadonlyArray<{ readonly operation?: unknown }>
  readonly diagnostics?: ReadonlyArray<{ readonly code?: unknown; readonly path?: unknown }>
}

export function redact(text: string, secrets: readonly string[]) {
  return secrets.reduce((value, secret) => (secret.length === 0 ? value : value.split(secret).join("[redacted]")), text)
}

function parse(value: string): Session | undefined {
  try {
    const parsed = JSON.parse(value) as { session?: Session }
    return parsed.session && typeof parsed.session === "object" ? parsed.session : undefined
  } catch {
    return undefined
  }
}

/**
 * nono appends the session object after the command's own stderr and may also emit a separate proxy block, so walk
 * back from the last `"session"` key through candidate object starts until one parses.
 */
function session(text: string): Session | undefined {
  const marker = text.lastIndexOf('"session"')
  if (marker < 0) return undefined
  let start = text.lastIndexOf("{", marker)
  for (let tries = 0; start >= 0 && tries < 32; tries++) {
    const tail = text.slice(start).trim()
    const parsed = parse(tail) ?? parse(tail.slice(0, tail.lastIndexOf("}") + 1))
    if (parsed) return parsed
    start = start === 0 ? -1 : text.lastIndexOf("{", start - 1)
  }
  return undefined
}

function strings(values: ReadonlyArray<unknown> | undefined) {
  return (values ?? []).flatMap((value) => (typeof value === "string" ? [value] : []))
}

function fromSession(value: Session, fallback: number): Diagnostics | undefined {
  const codes = strings(value.diagnostics?.map((entry) => entry.code))
  const operations = strings(value.violations?.map((entry) => entry.operation))
  const paths = [
    ...new Set([
      ...strings(value.denials?.map((entry) => entry.path)),
      ...strings(value.diagnostics?.map((entry) => entry.path)),
    ]),
  ]
  const exit = typeof value.exit_code === "number" ? value.exit_code : fallback
  // Some denials are recorded only as a data-access violation (#1796/#2209), and metadata violations are noisy
  // enough to ignore. `command_failed_*` is generic advice present on every run, successful ones included.
  const data = operations.some((operation) => operation === "file-read-data" || operation === "file-write-data")
  const kind: DenialKind | undefined =
    codes.includes("sandbox_denied_network") || operations.includes("network-outbound")
      ? "denied-network"
      : codes.includes("sandbox_denied_unix_socket")
        ? "denied-socket"
        : codes.includes("sandbox_denied_path") || data || paths.length > 0
          ? "denied-path"
          : codes.includes("command_not_found")
            ? "not-found"
            : exit === 0
              ? undefined
              : "unknown"
  return kind === undefined ? undefined : { kind, codes, paths, exit, text: "" }
}

/** Raw stderr only names a denial for a failed launch; a successful command's error-looking text is not one. */
function fromOutput(code: number, text: string): Diagnostics | undefined {
  if (code === 0) return undefined
  const trimmed = text.trim()
  const kind: DenialKind = /Command execution failed:.*cannot find binary path/.test(text)
    ? "not-found"
    : /Operation not permitted|Permission denied/.test(text)
      ? "denied-path"
      : /Couldn'?t connect|Could not connect|Connection refused|network is unreachable|Temporary failure in name resolution/i.test(
            text,
          )
        ? "denied-network"
        : trimmed.length === 0
          ? "unknown"
          : "application"
  return { kind, codes: [], paths: [], exit: code, text }
}

export function classify(input: {
  readonly code: number
  readonly stderr: string
  readonly secrets?: readonly string[]
}): Diagnostics | undefined {
  const text = redact(input.stderr, input.secrets ?? [])
  const parsed = session(text)
  const loose = fromOutput(input.code, text)
  if (parsed === undefined) return loose
  const strict = fromSession(parsed, input.code)
  // `undefined` here is the session's success verdict; the raw fallback must never overturn it.
  if (strict === undefined) return undefined
  // A session can parse while its denial records are incomplete (#1796/#2209); the raw output may still name the
  // cause. Upgrade only an otherwise unknown verdict, and only from a specific raw signal: a bare "application"
  // guess must not overwrite the honest unknown.
  const specific = loose !== undefined && loose.kind !== "unknown" && loose.kind !== "application"
  const kind = strict.kind === "unknown" && specific ? loose.kind : strict.kind
  return { ...strict, kind, text }
}
