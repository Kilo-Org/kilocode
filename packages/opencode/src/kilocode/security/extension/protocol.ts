import type { ToolCapabilityName } from "../types"

/**
 * Wire contract between Kilo and a permissioned extension host.
 *
 * The host is a separate process. It never sends host code back — only *operation requests* from a
 * closed set, which the main process adjudicates with the existing security engine and then performs
 * on the extension's behalf. An operation the contract does not name fails safe.
 */
export namespace ExtensionProtocol {
  /** Structural identity of a running extension. Never taken from anything the extension says. */
  export interface Identity {
    /** `custom-tool` or `plugin`. */
    type: "custom-tool" | "plugin"
    /** Origin the trust boundary classified the entrypoint as. */
    origin: string
    /** Canonical path of the approved entrypoint. */
    source: string
    /** SHA-256 the approval was keyed by (the closure digest for a multi-file extension). */
    digest: string
    /** Workspace the extension was discovered in. */
    workspace: string
    /** Tool / plugin id, once the host reports it. */
    id?: string
    /** Capabilities the user granted this digest. */
    granted: ToolCapabilityName[]
  }

  /** Main → host. */
  export type Command =
    | { kind: "load"; id: number; file: string; type: Identity["type"] }
    | { kind: "invoke"; id: number; tool: string; args: unknown }
    | { kind: "hook"; id: number; name: string; input: unknown; output: unknown }
    | { kind: "capability-result"; id: number; ok: boolean; value?: unknown; error?: string }
    | { kind: "shutdown"; id: number }

  /** The privileged operations an extension may ask the main process to perform for it. */
  export type Capability =
    | { op: "fs.read"; path: string }
    | { op: "fs.write"; path: string; data: string }
    | { op: "net.request"; url: string; method?: string; body?: string }
    | { op: "process.spawn"; command: string }

  /** Host → main. */
  export type Event =
    | { kind: "loaded"; id: number; ok: true; tools: { id: string; description: string }[]; hooks: string[] }
    | { kind: "failed"; id: number; ok: false; error: string }
    | { kind: "invoked"; id: number; ok: boolean; output?: string; error?: string }
    | { kind: "hooked"; id: number; ok: boolean; output?: unknown; error?: string }
    | { kind: "capability"; id: number; request: Capability }
    | { kind: "ready" }

  export const CAPABILITY_OPS: ReadonlySet<string> = new Set(["fs.read", "fs.write", "net.request", "process.spawn"])

  /** Capability each operation needs before the engine even looks at its arguments. */
  export const REQUIRED: Record<string, ToolCapabilityName> = {
    "fs.read": "filesystem-read",
    "fs.write": "filesystem-write",
    "net.request": "network",
    "process.spawn": "process",
  }

  export function encode(value: Command | Event): string {
    return JSON.stringify(value) + "\n"
  }

  export function decode<T>(line: string): T | undefined {
    const text = line.trim()
    if (text.length === 0) return undefined
    try {
      return JSON.parse(text) as T
    } catch {
      return undefined
    }
  }
}
