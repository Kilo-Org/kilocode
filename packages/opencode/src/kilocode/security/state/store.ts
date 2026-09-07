import { createHash, randomBytes } from "crypto"
import type { NormalizedPath, PathRelation } from "../types"
import { SecretValues } from "./values"

/**
 * Per-session security state for the stateful secret → egress layer.
 *
 * What is tracked, and only this:
 * - sensitive resources the agent *obtained* (a read that executed), by path fingerprint and label —
 *   a name that was merely mentioned in a denied or rejected request is never recorded;
 * - files that received sensitive contents through a controlled built-in flow (copy, move, redirect,
 *   pipeline, a write whose content carries a tracked value), so a later upload of that file is
 *   recognised;
 * - salted digests of value-like tokens read from those resources — never the values;
 * - a short ring of security events (kinds and rule ids only).
 *
 * Observations are recorded as *pending* against the tool call that asked, and committed only when
 * that call completes successfully (the content was really obtained), or discarded when it was
 * refused. State is keyed by the root session so a sub-agent's read is visible to its parent, and is
 * never shared between unrelated sessions. Nothing here is persisted or logged.
 */
export namespace SecuritySessionState {
  export type Label = "credential" | "private-key" | "secret" | "token" | "production-config"

  export type TaintVia = "copy" | "move" | "redirect" | "pipeline" | "write-content"

  export interface Read {
    fingerprint: string
    labels: Label[]
    relation: PathRelation
    at: number
  }

  export interface Taint {
    labels: Label[]
    via: TaintVia
    at: number
  }

  export interface Event {
    at: number
    kind:
      | "sensitive-read"
      | "content-secret"
      | "taint"
      | "untaint"
      | "egress-denied"
      | "egress-asked"
      | "discard"
      | "reset"
    labels?: Label[]
    rule?: string
    via?: TaintVia
  }

  export interface Pending {
    reads: { canonical: string; labels: Label[]; relation: PathRelation }[]
    taints: { canonical: string; labels: Label[]; via: TaintVia }[]
    untaints: string[]
    /**
     * Resources this call would read whose *path* says nothing about sensitivity.
     * They become sensitive only if the content the call actually returned is classified as credential
     * material — so a name alone never marks anything, and a refused call marks nothing at all.
     */
    candidates?: { canonical: string; relation: PathRelation }[]
  }

  /**
   * What the content classifier found in the output a completed call actually produced. `values` are
   * fingerprinted immediately and never stored; `kinds` are detector ids for the audit event.
   */
  export interface Observed {
    labels: Label[]
    values: string[]
    kinds: string[]
    /** Resource id to record when the call named no candidate path (e.g. an MCP result). */
    source?: string
  }

  /**
   * Where a piece of text the agent read actually came from. This is the question the deterministic
   * layers never ask: they classify the *resource* a path names, not who wrote the words inside it.
   * A README, a dependency's README and a fetched page are all "ordinary workspace content" to the
   * path classifier, and all three are written by someone who is not the user.
   */
  export type ContentSource =
    | "workspace-file"
    | "source-comment"
    | "dependency"
    | "notebook"
    | "ci-config"
    | "skill"
    | "mcp"
    | "web"
    | "tool"

  /**
   * A bounded excerpt of untrusted text the agent obtained, kept only so a later action can be judged
   * against what the session was told. Never logged, never persisted, never leaves the process except
   * to a classifier provider the user opted into.
   */
  export interface Ingested {
    source: ContentSource
    /** Basename only: the directory carries the user's identity and none of the meaning. */
    name: string
    excerpt: string
    at: number
  }

  interface State {
    root: string
    salt: string
    createdAt: number
    updatedAt: number
    reads: Read[]
    tainted: Map<string, Taint>
    values: Set<string>
    events: Event[]
    pending: Map<string, Pending & { at: number }>
    ingested: Ingested[]
    /**
     * What the user asked for this turn, in the user's own words, bounded. Trusted in the sense that
     * the user typed it — never in the sense that it grants anything. Absent unless recorded.
     */
    goal?: string
  }

  export interface Snapshot {
    root: string
    reads: number
    tainted: number
    values: number
    labels: Label[]
    pending: number
    events: Event[]
  }

  const MAX_SESSIONS = 512
  const TTL_MS = 12 * 60 * 60_000
  const MAX_EVENTS = 64
  const MAX_READS = 256
  const MAX_TAINTED = 2048
  const MAX_VALUES = 20_000
  const MAX_PENDING = 64
  /** How many untrusted excerpts a session keeps, and how much of each. Bounded on purpose: this is
   *  a window on what the agent was recently told, not a transcript. */
  const MAX_INGESTED = 8
  const EXCERPT_LIMIT = 2_000
  const GOAL_LIMIT = 500

  const states = new Map<string, State>()
  let resolver: (sessionID: string) => string = (sessionID) => sessionID

  /** Install the session → root-session resolver (registered by the Kilo session registry). */
  export function useRootResolver(fn: (sessionID: string) => string) {
    resolver = fn
  }

  export function rootOf(sessionID: string): string {
    try {
      return resolver(sessionID) || sessionID
    } catch {
      return sessionID
    }
  }

  export function fingerprint(canonical: string) {
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
  }

  function sweep(now: number) {
    for (const [key, state] of states) {
      if (now - state.updatedAt > TTL_MS) states.delete(key)
    }
    while (states.size > MAX_SESSIONS) {
      const oldest = states.keys().next().value
      if (oldest === undefined) break
      states.delete(oldest)
    }
  }

  function touch(state: State, now: number) {
    state.updatedAt = now
    // Re-insert so Map iteration order doubles as LRU order.
    states.delete(state.root)
    states.set(state.root, state)
  }

  function event(state: State, item: Event) {
    state.events.push(item)
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
  }

  export function get(sessionID: string): State | undefined {
    return states.get(rootOf(sessionID))
  }

  function open(sessionID: string, now = Date.now()): State {
    const root = rootOf(sessionID)
    sweep(now)
    const existing = states.get(root)
    if (existing) {
      touch(existing, now)
      return existing
    }
    const state: State = {
      root,
      salt: randomBytes(16).toString("hex"),
      createdAt: now,
      updatedAt: now,
      reads: [],
      tainted: new Map(),
      values: new Set(),
      events: [],
      pending: new Map(),
      ingested: [],
    }
    states.set(root, state)
    return state
  }

  /** Drop everything known about a session (its root). Used at session end and by tests. */
  export function reset(sessionID: string) {
    states.delete(rootOf(sessionID))
  }

  export function resetAll() {
    states.clear()
  }

  /** Labels that make a path a sensitive resource for this layer (reuses the path classification). */
  export function labelsFor(target: NormalizedPath): Label[] {
    const out = new Set<Label>()
    if (target.labels.includes("private-key")) out.add("private-key")
    if (target.labels.includes("credential")) out.add("credential")
    if (target.labels.includes("secret")) out.add("secret")
    if (target.labels.includes("kilo-state") || target.labels.includes("kilo-config")) out.add("token")
    const base = target.canonical.split(/[\\/]/).at(-1) ?? ""
    if (out.has("secret") && /\.(production|prod)(\.|$)/i.test(base)) out.add("production-config")
    return [...out]
  }

  /**
   * Remember that the agent read untrusted text. Content only — no decision, no classification, no
   * model call: this runs on the hot path of every completed read, so it must stay a bounded copy.
   */
  export function recordIngested(sessionID: string, item: Omit<Ingested, "at">) {
    const excerpt = item.excerpt.slice(0, EXCERPT_LIMIT)
    if (excerpt.trim().length === 0) return
    const now = Date.now()
    const state = open(sessionID, now)
    // The window holds *distinct* things the agent was told, and the newest reading of each. Reading
    // one source again replaces its earlier entry rather than pushing a second one — the later text
    // is what the agent now has, and the earlier is stale.
    //
    // This is what keeps the window expensive to flush. It is eight entries deep and evicts oldest
    // first, so without deduplication anything the agent can call repeatedly and cheaply — an
    // argument-free MCP resource listing, the same file read in a loop — pushes older excerpts out
    // and can empty the semantic layer's view of what it read. With it, repetition costs one slot
    // however often it happens, and evicting a real excerpt takes eight *different* sources.
    const seen = state.ingested.findIndex((entry) => entry.source === item.source && entry.name === item.name)
    if (seen >= 0) state.ingested.splice(seen, 1)
    state.ingested.push({ ...item, excerpt, at: now })
    if (state.ingested.length > MAX_INGESTED) state.ingested.splice(0, state.ingested.length - MAX_INGESTED)
    touch(state, now)
  }

  /** The untrusted text this session has read, newest last. */
  export function ingestedOf(sessionID: string): readonly Ingested[] {
    return get(sessionID)?.ingested ?? []
  }

  /**
   * Record what the user asked for, in their own words. Evidence about intent, never authority: a
   * request that matches a dangerous action does not make the action allowed, it only makes the
   * mismatch signal quieter.
   */
  export function recordGoal(sessionID: string, text: string) {
    const goal = text.trim().slice(0, GOAL_LIMIT)
    if (goal.length === 0) return
    const now = Date.now()
    const state = open(sessionID, now)
    state.goal = goal
    touch(state, now)
  }

  export function goalOf(sessionID: string): string | undefined {
    return get(sessionID)?.goal
  }

  /** True once the session obtained the contents of at least one sensitive resource. */
  export function hasSecretContext(sessionID: string): boolean {
    const state = get(sessionID)
    return state !== undefined && state.reads.length > 0
  }

  export function labelsOf(sessionID: string): Label[] {
    const state = get(sessionID)
    if (!state) return []
    return [...new Set(state.reads.flatMap((read) => read.labels))]
  }

  /** Candidate resources recorded for a call, so the caller can name the source of observed content. */
  export function pendingCandidates(sessionID: string, callID: string): { canonical: string }[] {
    return get(sessionID)?.pending.get(callID)?.candidates ?? []
  }

  export function taintOf(sessionID: string, canonical: string): Taint | undefined {
    return get(sessionID)?.tainted.get(canonical)
  }

  /** Does any candidate token equal a value read from a sensitive resource in this session? */
  export function matches(sessionID: string, candidates: string[]): boolean {
    const state = get(sessionID)
    if (!state || state.values.size === 0) return false
    for (const candidate of candidates) {
      if (state.values.has(SecretValues.digest(state.salt, candidate))) return true
    }
    return false
  }

  /** Remember what a tool call *would* obtain or taint; applied by {@link commit}, dropped by {@link discard}. */
  export function recordPending(sessionID: string, callID: string, pending: Pending) {
    if (
      pending.reads.length === 0 &&
      pending.taints.length === 0 &&
      pending.untaints.length === 0 &&
      (pending.candidates?.length ?? 0) === 0
    )
      return
    const state = open(sessionID)
    const existing = state.pending.get(callID)
    if (existing) {
      existing.reads.push(...pending.reads)
      existing.taints.push(...pending.taints)
      existing.untaints.push(...pending.untaints)
      if (pending.candidates?.length) existing.candidates = [...(existing.candidates ?? []), ...pending.candidates]
      return
    }
    if (state.pending.size >= MAX_PENDING) {
      const oldest = state.pending.keys().next().value
      if (oldest !== undefined) state.pending.delete(oldest)
    }
    state.pending.set(callID, { ...pending, at: Date.now() })
  }

  /** Apply a pending observation directly (used when no tool call links the ask to an execution). */
  export function apply(
    sessionID: string,
    pending: Pending,
    readFile?: (canonical: string) => string | undefined,
    observed?: Observed,
  ) {
    const state = open(sessionID)
    const now = Date.now()
    let reads = 0
    let taints = 0
    const seen = new Set<string>()
    for (const read of pending.reads) {
      if (seen.has(read.canonical)) continue
      seen.add(read.canonical)
      const key = fingerprint(read.canonical)
      if (!state.reads.some((item) => item.fingerprint === key)) {
        state.reads.push({ fingerprint: key, labels: read.labels, relation: read.relation, at: now })
        if (state.reads.length > MAX_READS) state.reads.splice(0, state.reads.length - MAX_READS)
        event(state, { at: now, kind: "sensitive-read", labels: read.labels })
        reads += 1
      }
      const text = readFile?.(read.canonical)
      if (text !== undefined) {
        for (const value of SecretValues.extract(text)) {
          if (state.values.size >= MAX_VALUES) break
          state.values.add(SecretValues.digest(state.salt, value))
        }
      }
    }
    for (const taint of pending.taints) {
      const previous = state.tainted.get(taint.canonical)
      const labels = [...new Set([...(previous?.labels ?? []), ...taint.labels])]
      state.tainted.set(taint.canonical, { labels, via: taint.via, at: now })
      if (state.tainted.size > MAX_TAINTED) {
        const oldest = state.tainted.keys().next().value
        if (oldest !== undefined) state.tainted.delete(oldest)
      }
      event(state, { at: now, kind: "taint", labels, via: taint.via })
      taints += 1
    }
    for (const canonical of pending.untaints) {
      if (state.tainted.delete(canonical)) event(state, { at: now, kind: "untaint" })
    }

    // Content the call really returned was classified as credential material. The
    // resources it came from become sensitive, and the values are fingerprinted — never stored.
    if (observed && observed.labels.length > 0) {
      const sources = (pending.candidates ?? []).map((item) => ({ canonical: item.canonical, relation: item.relation }))
      const targets: { canonical: string; relation: PathRelation }[] =
        sources.length > 0 ? sources : [{ canonical: observed.source ?? "content", relation: "unknown" }]
      for (const target of targets) {
        const key = fingerprint(target.canonical)
        if (state.reads.some((item) => item.fingerprint === key)) continue
        state.reads.push({ fingerprint: key, labels: observed.labels, relation: target.relation, at: now })
        if (state.reads.length > MAX_READS) state.reads.splice(0, state.reads.length - MAX_READS)
        reads += 1
      }
      for (const value of observed.values) {
        if (state.values.size >= MAX_VALUES) break
        state.values.add(SecretValues.digest(state.salt, value))
      }
      event(state, { at: now, kind: "content-secret", labels: observed.labels, rule: observed.kinds.join(",") })
    }

    touch(state, now)
    return { reads, taints }
  }

  /**
   * The tool call completed: what it asked to read/taint really happened. `observed` carries what the
   * content classifier found in the output the call actually produced, so a session
   * becomes sensitive from observed content, never from a name or a refused request.
   */
  export function commit(
    sessionID: string,
    callID: string,
    readFile?: (canonical: string) => string | undefined,
    observed?: Observed,
  ) {
    const state = get(sessionID)
    const pending = state?.pending.get(callID)
    if (!pending && !observed) return { reads: 0, taints: 0 }
    if (state && pending) state.pending.delete(callID)
    return apply(sessionID, pending ?? { reads: [], taints: [], untaints: [] }, readFile, observed)
  }

  /** The tool call was refused or failed: nothing it asked for happened. */
  export function discard(sessionID: string, callID: string) {
    const state = get(sessionID)
    if (!state) return
    if (state.pending.delete(callID)) event(state, { at: Date.now(), kind: "discard" })
  }

  export function note(sessionID: string, item: Event) {
    const state = get(sessionID)
    if (!state) return
    event(state, item)
  }

  /** Counts and event kinds only — safe to log or assert on. */
  export function snapshot(sessionID: string): Snapshot | undefined {
    const state = get(sessionID)
    if (!state) return undefined
    return {
      root: state.root,
      reads: state.reads.length,
      tainted: state.tainted.size,
      values: state.values.size,
      labels: labelsOf(sessionID),
      pending: state.pending.size,
      events: [...state.events],
    }
  }

  /** Test hook: expire sessions as if `ms` had elapsed. */
  export function age(ms: number) {
    for (const state of states.values()) state.updatedAt -= ms
    sweep(Date.now())
  }

  export function size() {
    return states.size
  }
}
