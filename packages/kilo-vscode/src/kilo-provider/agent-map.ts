/**
 * The agent map of a session: the session itself and everything it started,
 * directly or through another agent.
 *
 * The map starts at the requested session and walks down. Agents above it
 * did not come from it, so they stay out. A Task subagent is a child session
 * (`parentID`). An Agent Manager session that an `agent_manager` call started
 * is a root session in a sibling worktree, so it names its starter in session
 * metadata instead (see `prompt-attribution.ts`). A background process names
 * the session that started it.
 *
 * The walk reads the backend, not the webview store: a webview only holds the
 * sessions it has opened, and a nested subagent is rarely one of them.
 *
 * A revert hides the calls of the turns it undoes, and the next message
 * deletes them, but what those calls started stays in the backend. So the map
 * reads the transcript of each session that started something and leaves out
 * what no remaining call started, once it has stopped. Anything still running
 * stays, so it can be stopped.
 */

import type { BackgroundProcessInfo, KiloClient, Part, Session, SessionStatus } from "@kilocode/sdk/v2/client"
import { REQUEST, SOURCE } from "../agent-manager/prompt-attribution"
import { getErrorMessage, sameDirectory } from "../kilo-provider-utils"
import type {
  AgentMap,
  AgentMapLoadedMessage,
  AgentMapNode,
  AgentMapStatus,
} from "../../webview-ui/src/types/messages/agent-map"

/** Nodes past this are left out, so a runaway fan-out cannot stall the host. */
const LIMIT = 200

type Item = Pick<
  Session,
  "id" | "parentID" | "title" | "agent" | "model" | "metadata" | "time" | "tokens" | "cost" | "directory" | "revert"
>

/** The metadata key under which each tool records what its call started. */
const STARTS = new Map([
  ["task", "sessionId"],
  ["agent_manager", "requestID"],
  ["background_process", "processID"],
])

/** `background_process` records its process on every action. Only these start one. */
const SPAWNS = new Set(["start", "monitor"])

/**
 * How long the transcript of a working session is trusted while it lacks a
 * call for something it owns. A call can record what it started only when it
 * ends, after a quick process has already stopped.
 */
const RECHECK = 10_000

interface Job {
  status: "running" | "completed" | "error" | "cancelled"
  started_at: number
  completed_at?: number
  metadata?: Record<string, unknown>
}

export interface Facts {
  /** The session the map is requested for, its root. */
  root: string
  sessions: Item[]
  /** Session status by session ID. A missing session is idle. */
  statuses: Record<string, SessionStatus>
  /** Sessions with a pending permission or question. */
  waiting: ReadonlySet<string>
  /** Background Task jobs of the parents in the family. */
  jobs: Job[]
  processes: BackgroundProcessInfo[]
  /**
   * For each session whose transcript was read, what its remaining tool calls
   * started. A session missing here was not read, so nothing under it is
   * left out.
   */
  calls?: ReadonlyMap<string, ReadonlySet<string>>
}

function text(item: Pick<Session, "metadata">, key: string) {
  const value = item.metadata?.[key]
  return typeof value === "string" && value ? value : undefined
}

function source(item: Pick<Session, "metadata">) {
  return text(item, SOURCE)
}

/**
 * What the call that started a node recorded about it, to find that call in
 * the starter's transcript. Agent Manager sessions stamped before requests
 * were, and processes a subagent hands to its parent, cannot be traced.
 */
function claim(item: Item, kind: "task" | "session") {
  return kind === "task" ? item.id : text(item, REQUEST)
}

function trace(item: BackgroundProcessInfo) {
  return item.lifetime === "parent" ? undefined : item.id
}

/** The parts a transcript still shows, as the chat shows them under a revert. */
function visible(message: { info: { id: string }; parts: Part[] }, revert: Session["revert"]) {
  if (!revert || message.info.id < revert.messageID) return message.parts
  if (message.info.id !== revert.messageID || !revert.partID) return []
  const index = message.parts.findIndex((part) => part.id === revert.partID)
  return index < 0 ? [] : message.parts.slice(0, index)
}

/** What the tool calls a transcript still shows started. */
export function starts(messages: Array<{ info: { id: string }; parts: Part[] }>, revert?: Session["revert"]) {
  return messages.flatMap((message) =>
    visible(message, revert).flatMap((part) => {
      const key = part.type === "tool" ? STARTS.get(part.tool) : undefined
      if (!key || part.type !== "tool" || !("metadata" in part.state)) return []
      if (part.tool === "background_process" && !SPAWNS.has(String(part.state.input.action))) return []
      const value = part.state.metadata?.[key]
      return typeof value === "string" ? [value] : []
    }),
  )
}

/** The session that started `item` among the known ones, and how. */
function origin(item: Item, known: ReadonlyMap<string, Item>) {
  if (item.parentID && known.has(item.parentID)) return { id: item.parentID, kind: "task" as const }
  const id = source(item)
  if (id && known.has(id)) return { id, kind: "session" as const }
  return undefined
}

/** Task sessions are titled "<description> (@<agent> subagent)". The map shows the agent on its own. */
function title(item: Item) {
  return item.title.replace(/\s*\(@[^)]+ subagent\)$/, "").trim() || item.title
}

function status(item: Item, facts: Facts, job: Job | undefined): AgentMapStatus {
  if (facts.waiting.has(item.id)) return "waiting"
  const type = facts.statuses[item.id]?.type
  if (type === "busy" || type === "retry") return "running"
  if (job?.status === "error" || job?.status === "cancelled") return job.status
  return "done"
}

function processStatus(item: BackgroundProcessInfo): AgentMapStatus {
  if (item.status === "failed") return "error"
  if (item.status === "stopped") return "cancelled"
  if (item.status === "exited") return item.exitCode ? "error" : "done"
  return "running"
}

/** The sessions each session started, oldest first. */
function offspring(sessions: Item[], known: ReadonlyMap<string, Item>, top: Item) {
  const kids = new Map<string, Array<{ item: Item; kind: "task" | "session" }>>()
  for (const item of sessions) {
    const up = origin(item, known)
    if (!up || item.id === top.id) continue
    kids.set(up.id, [...(kids.get(up.id) ?? []), { item, kind: up.kind }])
  }
  for (const list of kids.values()) list.sort((a, b) => a.item.time.created - b.item.time.created)
  return kids
}

function model(item: Item) {
  if (!item.model) return undefined
  // The server stores the Default variant as "default".
  const variant = item.model.variant && item.model.variant !== "default" ? item.model.variant : undefined
  return { providerID: item.model.providerID, modelID: item.model.id, ...(variant ? { variant } : {}) }
}

function sessionNode(
  item: Item,
  place: { kind: AgentMapNode["kind"]; parent?: string },
  state: AgentMapStatus,
  job: Job | undefined,
): AgentMapNode {
  const live = state === "running" || state === "waiting"
  return {
    id: item.id,
    kind: place.kind,
    parent: place.parent,
    title: title(item),
    agent: item.agent,
    model: model(item),
    status: state,
    background: job?.metadata?.background === true ? true : undefined,
    started: job?.started_at ?? item.time.created,
    finished: live ? undefined : (job?.completed_at ?? item.time.updated),
    tokens: item.tokens,
    cost: item.cost,
  }
}

function processNode(item: BackgroundProcessInfo): AgentMapNode {
  const state = processStatus(item)
  return {
    id: item.id,
    kind: "process",
    parent: item.sessionID,
    title: item.description ?? item.command,
    status: state,
    started: item.time.started,
    finished: state === "running" ? undefined : (item.time.ended ?? item.time.updated),
    command: item.command,
    pid: item.pid,
    ports: item.ports.length > 0 ? item.ports : undefined,
  }
}

/**
 * What the map leaves out because a revert removed the call that started it.
 * A node that still runs, or has anything running under it, stays.
 */
function reverted(
  facts: Facts,
  known: ReadonlyMap<string, Item>,
  kids: ReturnType<typeof offspring>,
  jobs: ReadonlyMap<string, Job>,
) {
  const running = (item: BackgroundProcessInfo) => processStatus(item) === "running"
  const alive = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    const item = known.get(id)
    const state = item ? status(item, facts, jobs.get(id)) : "done"
    if (state === "running" || state === "waiting") return true
    if (facts.processes.some((proc) => proc.sessionID === id && running(proc))) return true
    return (kids.get(id) ?? []).some((kid) => alive(kid.item.id, seen))
  }
  const undone = (owner: string, key: string | undefined) => {
    const kept = facts.calls?.get(owner)
    return !!kept && !!key && !kept.has(key)
  }
  return {
    session: (owner: string, kid: { item: Item; kind: "task" | "session" }) =>
      undone(owner, claim(kid.item, kid.kind)) && !alive(kid.item.id, new Set()),
    process: (item: BackgroundProcessInfo) => undone(item.sessionID, trace(item)) && !running(item),
  }
}

/**
 * Lay the family out from the facts the backend returned. Pure, so the shape
 * of the map can be tested without a backend.
 */
export function build(facts: Facts): { map: AgentMap; dirs: Map<string, string> } {
  const known = new Map(facts.sessions.map((item) => [item.id, item]))
  const top = known.get(facts.root)
  if (!top) throw new Error(`Session ${facts.root} is not in the agent map facts.`)
  const kids = offspring(facts.sessions, known, top)
  const jobs = new Map(
    facts.jobs.flatMap((job) => {
      const id = job.metadata?.sessionId
      return typeof id === "string" ? [[id, job] as const] : []
    }),
  )
  const gone = reverted(facts, known, kids, jobs)

  const nodes: AgentMapNode[] = []
  const dirs = new Map<string, string>()
  // Breadth first, so a cut at the limit drops the deepest generations.
  const queue: Array<{ item: Item; kind: AgentMapNode["kind"]; parent?: string }> = [{ item: top, kind: "root" }]
  for (const entry of queue) {
    if (dirs.has(entry.item.id)) continue
    if (nodes.length >= LIMIT) break
    const job = jobs.get(entry.item.id)
    nodes.push(sessionNode(entry.item, entry, status(entry.item, facts, job), job))
    dirs.set(entry.item.id, entry.item.directory)
    for (const kid of kids.get(entry.item.id) ?? []) {
      if (!gone.session(entry.item.id, kid)) queue.push({ ...kid, parent: entry.item.id })
    }
  }
  const sessions = nodes.length
  const pending = queue.some((entry) => !dirs.has(entry.item.id))

  const procs = [...new Map(facts.processes.map((item) => [item.id, item])).values()]
    .filter((item) => dirs.has(item.sessionID) && !gone.process(item))
    .toSorted((a, b) => a.time.started - b.time.started)
  for (const item of procs.slice(0, LIMIT - sessions)) {
    nodes.push(processNode(item))
    // A process is reached through the backend instance of the session that owns it.
    dirs.set(item.id, dirs.get(item.sessionID) ?? top.directory)
  }

  const cut = pending || procs.length > LIMIT - sessions
  return {
    map: { root: top.id, nodes, ...(cut ? { truncated: true } : {}) },
    dirs,
  }
}

/** The last read of a transcript, by session ID. */
type Memo = Map<string, { stamp: string; at: number; kept: ReadonlySet<string>; seen: ReadonlySet<string> }>

/**
 * What the remaining calls in a transcript started. The map polls, so a
 * transcript is read again only when it can have changed what it holds: its
 * session changed or started or stopped running, or it owns something the
 * last read did not look for. While the session runs, a read that lacks
 * something it owns is trusted for `RECHECK`.
 */
export async function transcript(
  client: KiloClient,
  item: Item,
  keys: string[],
  busy: boolean,
  memo: Memo,
  now = Date.now(),
) {
  const stamp = [item.time.updated, item.revert?.messageID, item.revert?.partID, busy].join(" ")
  const last = memo.get(item.id)
  if (
    last?.stamp === stamp &&
    keys.every((key) => last.kept.has(key) || last.seen.has(key)) &&
    (!busy || now - last.at < RECHECK || keys.every((key) => last.kept.has(key)))
  ) {
    return last.kept
  }
  const res = await client.session.messages({ sessionID: item.id, directory: item.directory }).catch((err: unknown) => {
    console.error("[Kilo New] KiloProvider: Failed to read a transcript for the agent map:", err)
    return undefined
  })
  if (!res?.data) return undefined
  const kept = new Set(starts(res.data, item.revert))
  memo.set(item.id, { stamp, at: now, kept, seen: new Set(keys) })
  return kept
}

/**
 * Read the transcripts of the sessions that own something on the map that
 * has stopped. What still works stays on the map, so its call is not needed.
 */
export async function transcripts(
  client: KiloClient,
  list: Item[],
  processes: BackgroundProcessInfo[],
  live: { statuses: Record<string, SessionStatus>; waiting: ReadonlySet<string> },
  memo: Memo,
) {
  const known = new Map(list.map((item) => [item.id, item]))
  const busy = (id: string) => ["busy", "retry"].includes(live.statuses[id]?.type ?? "")
  const owned = new Map<string, { item: Item; keys: string[] }>()
  const add = (owner: string, key: string | undefined) => {
    const item = known.get(owner)
    if (!item || !key) return
    owned.set(owner, { item, keys: [...(owned.get(owner)?.keys ?? []), key] })
  }
  for (const item of list) {
    const up = origin(item, known)
    if (up && !busy(item.id) && !live.waiting.has(item.id)) add(up.id, claim(item, up.kind))
  }
  // A subagent hands the processes it started for its parent over when it
  // finishes, so a process may have been started by any subagent of its owner
  // that existed by then.
  const handed: Array<{ owner: string; key: string; kids: Item[] }> = []
  for (const proc of processes) {
    const key = trace(proc)
    if (!key || processStatus(proc) === "running") continue
    add(proc.sessionID, key)
    const kids = list.filter((kid) => kid.parentID === proc.sessionID && kid.time.created <= proc.time.started)
    for (const kid of kids) add(kid.id, key)
    handed.push({ owner: proc.sessionID, key, kids })
  }
  for (const id of memo.keys()) if (!owned.has(id)) memo.delete(id)
  const reads = new Map(
    await Promise.all(
      [...owned.values()].map(
        async (entry) =>
          [entry.item.id, await transcript(client, entry.item, entry.keys, busy(entry.item.id), memo)] as const,
      ),
    ),
  )
  const calls = new Map<string, Set<string>>()
  for (const [id, kept] of reads) if (kept) calls.set(id, new Set(kept))
  for (const entry of handed) {
    // A subagent transcript that cannot be read may hold the call, so the process stays.
    if (entry.kids.some((kid) => reads.get(kid.id)?.has(entry.key) ?? true)) calls.get(entry.owner)?.add(entry.key)
  }
  return calls
}

/** Read `sessionID` and everything it started from the backend. */
export async function load(client: KiloClient, sessionID: string, directory: string, memo: Memo = new Map()) {
  const { data: top } = await client.session.get({ sessionID, directory }, { throwOnError: true })
  const sessions = new Map<string, Item>([[top.id, top]])

  // Agent Manager sessions are roots in sibling worktrees, so the worktree
  // family list finds them. Only sessions active since the root started can
  // belong to it.
  const family = await client.experimental.session
    .list({ worktrees: true, roots: true, directory: top.directory, start: top.time.created, limit: LIMIT * 5 })
    .then((res) => (res.data ?? []).filter((item) => !!source(item)))

  let level: Item[] = [top]
  while (level.length > 0 && sessions.size < LIMIT) {
    const ids = new Set(level.map((item) => item.id))
    const found = await Promise.all(
      level.map((item) =>
        client.session.children({ sessionID: item.id, directory: item.directory }).then((res) => res.data ?? []),
      ),
    )
    const next = new Map<string, Item>()
    for (const item of [...found.flat(), ...family.filter((item) => ids.has(source(item) ?? ""))]) {
      if (!sessions.has(item.id)) next.set(item.id, item)
    }
    for (const item of next.values()) sessions.set(item.id, item)
    level = [...next.values()]
  }

  const list = [...sessions.values()]
  const roots = list
    .map((item) => item.directory)
    .filter((dir, index, all) => all.findIndex((other) => sameDirectory(other, dir)) === index)
  const live = await Promise.all(
    roots.map(async (dir) => {
      const [status, permissions, questions, processes] = await Promise.all([
        client.session.status({ directory: dir }),
        client.permission.list({ directory: dir }),
        client.question.list({ directory: dir }),
        client.backgroundProcess.list({ directory: dir }),
      ])
      return {
        statuses: status.data ?? {},
        waiting: [...(permissions.data ?? []), ...(questions.data ?? [])].map((item) => item.sessionID),
        processes: processes.data ?? [],
      }
    }),
  )
  // Background job state tells how a background Task agent ended.
  const parents = list.filter((item) => list.some((other) => other.parentID === item.id))
  const jobs = await Promise.all(
    parents.map((item) =>
      client.kilocode
        .backgroundJobs({ directory: item.directory, sessionID: item.id })
        .then((res) => (res.data ?? []) as Job[]),
    ),
  )

  const statuses: Record<string, SessionStatus> = Object.assign({}, ...live.map((item) => item.statuses))
  const waiting = new Set(live.flatMap((item) => item.waiting))
  const processes = live.flatMap((item) => item.processes)

  return build({
    root: top.id,
    sessions: list,
    statuses,
    waiting,
    jobs: jobs.flat(),
    processes,
    calls: await transcripts(client, list, processes, { statuses, waiting }, memo),
  })
}

interface Context {
  client: () => KiloClient | null
  /** The directory the provider routes a session to. */
  dir: (sessionID: string) => string
  post: (message: AgentMapLoadedMessage) => void
}

export function createAgentMap(ctx: Context) {
  // Where each node of the loaded maps lives, so Stop and Open reach the
  // backend instance that runs it. Processes map to the directory of the
  // session that owns them, which is the instance that tracks them.
  const dirs = new Map<string, string>()
  const memo: Memo = new Map()

  const request = async (sessionID: string, requestID: string) => {
    const base = { type: "agentMapLoaded", sessionID, requestID } as const
    const client = ctx.client()
    if (!client) {
      ctx.post({ ...base, error: "Not connected to the CLI backend." })
      return
    }
    await load(client, sessionID, ctx.dir(sessionID), memo).then(
      (result) => {
        for (const [id, dir] of result.dirs) dirs.set(id, dir)
        ctx.post({ ...base, map: result.map })
      },
      (err: unknown) => {
        console.error("[Kilo New] KiloProvider: Failed to load the agent map:", err)
        ctx.post({ ...base, error: getErrorMessage(err) || "Failed to load the agent map." })
      },
    )
  }

  const stop = async (sessionID: string, processID: string) => {
    const client = ctx.client()
    if (!client) return
    const directory = dirs.get(processID) ?? ctx.dir(sessionID)
    await client.backgroundProcess
      .stop({ processID, directory })
      .then((res) => {
        if (res.error) console.error("[Kilo New] KiloProvider: Failed to stop background process:", res.error)
      })
      .catch((err: unknown) => console.error("[Kilo New] KiloProvider: Failed to stop background process:", err))
  }

  return {
    /** The directory of a session or process seen in a loaded map. */
    directory: (id: string) => dirs.get(id),
    async handle(message: { type: string; sessionID?: unknown; requestID?: unknown; processID?: unknown }) {
      if (message.type === "requestAgentMap") {
        if (typeof message.sessionID === "string" && typeof message.requestID === "string")
          await request(message.sessionID, message.requestID)
        return true
      }
      if (message.type === "stopBackgroundProcess") {
        if (typeof message.sessionID === "string" && typeof message.processID === "string")
          await stop(message.sessionID, message.processID)
        return true
      }
      return false
    },
  }
}
