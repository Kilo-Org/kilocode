import type { ToolCapabilityName, ToolDescriptor, ToolProvenance } from "../types"

/**
 * The security capability model for tools.
 *
 * Every tool the model can call is classified before it runs. A classification answers two
 * questions: *what is this tool allowed to do* (its capabilities) and *does it adjudicate its own
 * side effect* (`asks`). The table below is the single source of truth for Kilo's own tools — the
 * execution gate derives its "needs no envelope ask" sets from it rather than keeping a second list,
 * so a tool cannot be added to one and forgotten in the other.
 *
 * Three rules govern the model:
 * - a **known read-only** tool takes the existing fast path;
 * - a **known side-effecting** tool is evaluated by the engine exactly as before;
 * - an **unknown** tool is never silently allowed. Nothing vouches for it, so the conservative floor
 *   is a hard ASK unless a higher-trust policy already reached something stricter.
 *
 * Safety of a tool is never inferred from its name or its description. A tool that is absent from
 * the table is unknown even if it is called `read_only_helper`; the only ways to become known are
 * shipping in the table (Kilo-controlled) or an explicit declaration in the user's global config.
 */
export namespace ToolCapability {
  export interface Entry {
    capabilities: ToolCapabilityName[]
    /** True when the tool performs its own permission ask before its side effect. */
    asks: boolean
  }

  /**
   * Kilo's built-in tools. `asks: true` records the audited fact that the tool calls `ctx.ask`
   * before its side effect, so the ask-level gate already covers it and the execution gate does not
   * need to wrap it in an envelope ask.
   */
  export const BUILTIN: Readonly<Record<string, Entry>> = {
    // Pure question/answer and bookkeeping tools: no side effect at all.
    question: { capabilities: ["readonly"], asks: false },
    suggest: { capabilities: ["readonly"], asks: false },
    plan_enter: { capabilities: ["readonly"], asks: false },
    plan_exit: { capabilities: ["readonly"], asks: false },
    invalid: { capabilities: ["readonly"], asks: false },
    agent_manager_models: { capabilities: ["readonly"], asks: false },
    chart: { capabilities: ["readonly"], asks: false },
    todoread: { capabilities: ["readonly"], asks: false },
    list: { capabilities: ["readonly"], asks: false },
    codesearch: { capabilities: ["readonly"], asks: false },
    diagnostics: { capabilities: ["readonly"], asks: false },
    todowrite: { capabilities: ["readonly"], asks: true },

    // Filesystem.
    read: { capabilities: ["filesystem-read"], asks: true },
    glob: { capabilities: ["filesystem-read"], asks: true },
    grep: { capabilities: ["filesystem-read"], asks: true },
    lsp: { capabilities: ["filesystem-read"], asks: true },
    repo_overview: { capabilities: ["filesystem-read"], asks: true },
    kilo_local_recall: { capabilities: ["filesystem-read"], asks: true },
    kilo_memory_recall: { capabilities: ["filesystem-read"], asks: true },
    notebook_read: { capabilities: ["filesystem-read"], asks: true },
    board_read: { capabilities: ["filesystem-read"], asks: true },
    edit: { capabilities: ["filesystem-write"], asks: true },
    write: { capabilities: ["filesystem-write"], asks: true },
    apply_patch: { capabilities: ["filesystem-write"], asks: true },
    notebook_edit: { capabilities: ["filesystem-write"], asks: true },
    kilo_memory_save: { capabilities: ["filesystem-write"], asks: true },
    board_post: { capabilities: ["filesystem-write"], asks: true },

    // Process execution. `process` subsumes filesystem and network authority: what the command does
    // is decided by the shell rules on the normalised command, not by this table.
    bash: { capabilities: ["process"], asks: true },
    execute: { capabilities: ["process"], asks: true },
    background_process: { capabilities: ["process"], asks: true },
    interactive_terminal: { capabilities: ["process"], asks: true },
    notebook_execute: { capabilities: ["process"], asks: true },
    skill: { capabilities: ["filesystem-read", "process"], asks: true },

    // Outbound network.
    webfetch: { capabilities: ["network"], asks: true },
    websearch: { capabilities: ["network"], asks: true },
    browser_open: { capabilities: ["network"], asks: true },
    semantic_search: { capabilities: ["network"], asks: true },
    send_file: { capabilities: ["network"], asks: true },
    generate_image: { capabilities: ["network", "filesystem-write"], asks: true },
    repo_clone: { capabilities: ["network", "filesystem-write"], asks: true },
    /** Sends the message to the user's Kilo app; no ask of its own, so the envelope ask covers it. */
    notify_user: { capabilities: ["network"], asks: false },

    // Delegated authority that stays inside Kilo: the delegate's own actions are adjudicated by this
    // same engine in the child session, so delegation itself is not treated as an outbound channel.
    task: { capabilities: ["delegated-authority"], asks: true },
    agent_manager: { capabilities: ["delegated-authority"], asks: true },
    list_mcp_resources: { capabilities: ["delegated-authority"], asks: true },
    list_mcp_resource_templates: { capabilities: ["delegated-authority"], asks: true },
    read_mcp_resource: { capabilities: ["delegated-authority"], asks: true },
  }

  const NAMES = new Set<ToolCapabilityName>([
    "readonly",
    "filesystem-read",
    "filesystem-write",
    "process",
    "network",
    "package",
    "delegated-authority",
    "security-control",
    "unknown",
  ])

  /** Tools with no side effect whatsoever: the execution gate needs no envelope ask for them. */
  export const READONLY: ReadonlySet<string> = new Set(
    Object.entries(BUILTIN)
      .filter(([, entry]) => !entry.asks && entry.capabilities.every((item) => item === "readonly"))
      .map(([id]) => id),
  )

  /** Tools that ask for permission themselves before their side effect. */
  export const ASKING: ReadonlySet<string> = new Set(
    Object.entries(BUILTIN)
      .filter(([, entry]) => entry.asks)
      .map(([id]) => id),
  )

  export function of(tool: string): Entry | undefined {
    return Object.hasOwn(BUILTIN, tool) ? BUILTIN[tool] : undefined
  }

  /** True when the capability set contains nothing that can change the world. */
  export function readonly(capabilities: readonly ToolCapabilityName[]): boolean {
    return capabilities.length > 0 && capabilities.every((item) => item === "readonly")
  }

  /** True when the capability set is unknown, i.e. nothing vouches for what the tool may do. */
  export function unknown(capabilities: readonly ToolCapabilityName[]): boolean {
    return capabilities.length === 0 || capabilities.includes("unknown")
  }

  /** Capabilities that reach outside this machine and can therefore carry data out. */
  export function outbound(capabilities: readonly ToolCapabilityName[]): boolean {
    return capabilities.includes("network")
  }

  export type Declarations = ReadonlyArray<{ pattern: string; capabilities: ToolCapabilityName[] }>

  /**
   * Placeholder for a `*` while the rest of the pattern is regex-escaped, so the escaping cannot
   * turn the wildcard into a literal. NUL never appears in a tool id.
   */
  const STAR = "\0"

  function toRegExp(pattern: string) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? STAR : `\\${ch}`))
    return new RegExp(`^${escaped.replaceAll(STAR, ".*")}$`)
  }

  /**
   * Parse the user's capability declarations. Read from the **global** config only (like the mode
   * itself), so a repository can never declare capabilities for the tools it also ships.
   *
   * Shape: `{ "<tool id or glob>": "readonly" | ["network", "filesystem-read"] }`. Unrecognised
   * capability names are dropped rather than trusted, and a declaration that ends up empty leaves
   * the tool unknown.
   */
  export function declarations(value: unknown): Declarations {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return []
    const out: { pattern: string; capabilities: ToolCapabilityName[] }[] = []
    for (const [pattern, raw] of Object.entries(value as Record<string, unknown>)) {
      if (pattern.length === 0) continue
      const list = (Array.isArray(raw) ? raw : [raw]).filter((item): item is string => typeof item === "string")
      const capabilities = list.filter((item): item is ToolCapabilityName => NAMES.has(item as ToolCapabilityName))
      if (capabilities.length === 0 || capabilities.includes("unknown")) continue
      out.push({ pattern, capabilities: [...new Set(capabilities)] })
    }
    return out
  }

  function declared(tool: string, list: Declarations): ToolCapabilityName[] | undefined {
    // Last match wins, so a specific entry placed after a glob overrides it.
    let found: ToolCapabilityName[] | undefined
    for (const item of list) {
      if (toRegExp(item.pattern).test(tool)) found = item.capabilities
    }
    return found
  }

  export interface ResolveInput {
    tool: string
    provenance: ToolProvenance
    declarations?: Declarations
    mcp?: ToolDescriptor["mcp"]
    hints?: ToolDescriptor["hints"]
  }

  /**
   * Resolve a tool call's security descriptor.
   *
   * Trust order is structural: Kilo's own table applies only to tools the registry marked as
   * built-in, then the user's global declaration, then nothing. A workspace tool that happens to
   * share a built-in's id therefore does **not** inherit the built-in's capabilities.
   */
  export function resolve(input: ResolveInput): ToolDescriptor {
    const entry = input.provenance === "builtin" ? of(input.tool) : undefined
    if (entry) {
      return {
        tool: input.tool,
        provenance: input.provenance,
        capabilities: [...entry.capabilities],
        source: "builtin",
        asks: entry.asks,
        ...(input.mcp ? { mcp: input.mcp } : {}),
        ...(input.hints ? { hints: input.hints } : {}),
      }
    }
    const user = declared(input.tool, input.declarations ?? [])
    return {
      tool: input.tool,
      provenance: input.provenance,
      capabilities: user ? [...user] : [],
      source: user ? "declared" : "unknown",
      // Only Kilo's own tools are known to adjudicate their own side effects.
      asks: false,
      ...(input.mcp ? { mcp: input.mcp } : {}),
      ...(input.hints ? { hints: input.hints } : {}),
    }
  }
}
