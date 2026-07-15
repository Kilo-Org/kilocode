// kilocode_change - first-class local runtime presence for mobile.
// `RemoteRuntime` owns the per-process `runtimeId`, the safe display labels,
// the fixed launch directory, and the advertised capability set. The absolute
// launch directory is captured once at construction and never re-read; the
// only directory-derived value the cloud ever sees is the basename.
//
// `connectionId` is the stable transport identifier returned by
// `RemoteWS.connect()`. It is set once when the connection is created and
// remains stable for the lifetime of the `Connection` object, including
// across internal WebSocket reconnects. A process restart creates a new
// `Connection` with a new `connectionId` and a new `runtimeId`.

import z from "zod"

const Label = z
  .string()
  .min(1)
  .transform(value => {
    // Strip control characters and collapse internal whitespace, then truncate
    // to the 80-char wire cap. The truncation lives in the transform so a
    // long input is clamped instead of rejected — the cloud contract is the
    // single source of truth for the cap.
    const cleaned = value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
    return cleaned
  })
  .refine(value => value.length > 0, { message: "label must not be empty after sanitization" })

const Directory = z.string().min(1, { message: "directory must not be empty" })

const CliVersion = z.string().min(1).max(32)

const RUNTIME_CAPABILITIES = ["catalog.v1", "create-and-run.v1"] as const
export type LocalRuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number]

const Presence = z.object({
  runtimeId: z.string().uuid(),
  connectionId: z.string().min(1).max(128),
  protocolVersion: z.literal(1),
  cliVersion: CliVersion,
  displayName: z.string().min(1).max(80),
  projectName: z.string().min(1).max(80),
  capabilities: z
    .array(z.enum(RUNTIME_CAPABILITIES))
    .max(2)
    .refine(values => new Set(values).size === values.length, {
      message: "runtime capabilities must be unique",
    }),
})
export type LocalRuntimePresence = z.infer<typeof Presence>

export namespace RemoteRuntime {
  export type Options = {
    runtimeId: string
    connectionId: string
    cliVersion: string
    directory: string
    displayName: string
  }

  export type Interface = {
    readonly runtimeId: string
    setConnectionId(connectionId: string): void
    presence(): LocalRuntimePresence
  }

  export function create(options: Options): Interface {
    const runtimeId = z.string().uuid().parse(options.runtimeId)
    const cliVersion = CliVersion.parse(options.cliVersion)
    const directory = Directory.parse(options.directory)
    const displayName = Label.parse(options.displayName)
    const projectName = Label.parse(deriveProjectName(directory))
    const capabilities: LocalRuntimeCapability[] = [...RUNTIME_CAPABILITIES]
    let connectionId = options.connectionId

    return {
      get runtimeId() {
        return runtimeId
      },
      setConnectionId(next) {
        connectionId = z.string().min(1).max(128).parse(next)
      },
      presence() {
        return Presence.parse({
          runtimeId,
          connectionId,
          protocolVersion: 1,
          cliVersion,
          displayName,
          projectName,
          capabilities,
        })
      },
    }
  }

  function deriveProjectName(directory: string): string {
    // Strip trailing slashes so `/tmp/proj/` → "proj" (not "").
    const trimmed = directory.replace(/[\\/]+$/, "")
    const last = trimmed.split(/[\\/]/).pop() ?? ""
    return last.length === 0 ? "root" : last
  }
}
