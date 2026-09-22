import { Effect, Schema } from "effect"
import { sql } from "drizzle-orm"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Database } from "@opencode-ai/core/database/database"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionID } from "@/session/schema"
import { InstanceState } from "@/effect/instance-state"
import { Filesystem } from "@/util/filesystem"
import { WorktreeFamily } from "@/kilocode/worktree-family"

// Read-only, no-migration worktree economics. Every number here is derived
// from currently retained session/message/part/board rows (`basis: "retained"`):
// deleting or reverting transcript history removes it from these totals, so
// this is a productivity view, not an accounting-grade ledger.
export namespace WorktreeUsage {
  // ---------------------------------------------------------------------------
  // Wire schemas
  // ---------------------------------------------------------------------------

  const Basis = Schema.Literal("retained")
  const Currency = Schema.Literal("USD")

  const Tokens = Schema.Struct({
    input: NonNegativeInt,
    output: NonNegativeInt,
    reasoning: NonNegativeInt,
    cache: Schema.Struct({ read: NonNegativeInt, write: NonNegativeInt }),
  })
  type Tokens = typeof Tokens.Type

  const Usage = Schema.Struct({
    steps: NonNegativeInt,
    cost: Schema.Finite,
    tokens: Tokens,
  })
  type Usage = typeof Usage.Type

  const Coverage = Schema.Struct({
    timedSteps: NonNegativeInt,
    totalSteps: NonNegativeInt,
    closedTools: NonNegativeInt,
    totalTools: NonNegativeInt,
  })

  const Time = Schema.Struct({
    firstActivity: Schema.optional(NonNegativeInt),
    lastActivity: Schema.optional(NonNegativeInt),
    wallMs: Schema.optional(NonNegativeInt),
    modelMs: NonNegativeInt,
    toolMs: NonNegativeInt,
    activeMs: NonNegativeInt,
    coverage: Coverage,
  })
  type Time = typeof Time.Type

  const Communication = Schema.Struct({
    boardPosts: NonNegativeInt,
    boardReads: NonNegativeInt,
    agentManagerPrompts: NonNegativeInt,
    agentManagerReplies: NonNegativeInt,
    boardBytes: NonNegativeInt,
    // Board/Agent Manager tools never call a paid model themselves, so their
    // own direct cost is always zero. See models[]/agents[] for the cost of
    // model turns that peer communication may have triggered.
    directCost: Schema.Literal(0),
  })

  const ModelGroup = Schema.Struct({
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    variant: Schema.optional(Schema.String),
    ...Usage.fields,
  }).annotate({ identifier: "KilocodeWorktreeUsageModelGroup" })
  type ModelGroup = typeof ModelGroup.Type

  const AgentGroup = Schema.Struct({
    agent: Schema.String,
    ...Usage.fields,
  }).annotate({ identifier: "KilocodeWorktreeUsageAgentGroup" })
  type AgentGroup = typeof AgentGroup.Type

  const WorktreeKind = Schema.Literals(["primary", "linked"])
  type WorktreeKind = typeof WorktreeKind.Type

  const WorktreeSummary = Schema.Struct({
    directory: Schema.String,
    kind: WorktreeKind,
    rootSessions: NonNegativeInt,
    sessions: NonNegativeInt,
    subagents: NonNegativeInt,
    totals: Usage,
    time: Time,
    communication: Communication,
  }).annotate({ identifier: "KilocodeWorktreeUsageSummary" })
  type WorktreeSummary = typeof WorktreeSummary.Type

  export const Summaries = Schema.Struct({
    projectID: ProjectV2.ID,
    basis: Basis,
    currency: Currency,
    asOf: NonNegativeInt,
    worktrees: Schema.Array(WorktreeSummary),
  }).annotate({ identifier: "KilocodeWorktreeUsageSummaries" })
  export type Summaries = typeof Summaries.Type

  const SessionRow = Schema.Struct({
    id: SessionID,
    parentID: Schema.optional(SessionID),
    rootID: SessionID,
    title: Schema.String,
    agent: Schema.optional(Schema.String),
    archivedAt: Schema.optional(NonNegativeInt),
    createdAt: NonNegativeInt,
    direct: Usage,
    subtree: Usage,
    models: Schema.Array(ModelGroup),
    time: Time,
  }).annotate({ identifier: "KilocodeWorktreeUsageSessionRow" })
  type SessionRow = typeof SessionRow.Type

  export const Detail = Schema.Struct({
    projectID: ProjectV2.ID,
    basis: Basis,
    currency: Currency,
    asOf: NonNegativeInt,
    worktree: WorktreeSummary,
    models: Schema.Array(ModelGroup),
    agents: Schema.Array(AgentGroup),
    sessions: Schema.Array(SessionRow),
  }).annotate({ identifier: "KilocodeWorktreeUsageDetail" })
  export type Detail = typeof Detail.Type

  const Interval = Schema.Struct({
    start: NonNegativeInt,
    end: Schema.optional(NonNegativeInt),
  })
  type Interval = typeof Interval.Type

  const Status = Schema.Literals(["pending", "running", "completed", "error"])

  const GenerationEvent = Schema.Struct({
    kind: Schema.Literal("generation"),
    id: Schema.String,
    sessionID: SessionID,
    rootID: SessionID,
    agent: Schema.optional(Schema.String),
    providerID: Schema.optional(ProviderV2.ID),
    modelID: Schema.optional(ModelV2.ID),
    variant: Schema.optional(Schema.String),
    cost: Schema.Finite,
    tokens: Tokens,
    time: Interval,
  }).annotate({ identifier: "KilocodeWorktreeUsageGenerationEvent" })

  const ToolEvent = Schema.Struct({
    kind: Schema.Literal("tool"),
    id: Schema.String,
    sessionID: SessionID,
    rootID: SessionID,
    tool: Schema.String,
    status: Status,
    time: Schema.optional(Interval),
  }).annotate({ identifier: "KilocodeWorktreeUsageToolEvent" })

  const SubagentEvent = Schema.Struct({
    kind: Schema.Literal("subagent"),
    id: Schema.String,
    parentSessionID: SessionID,
    childSessionID: SessionID,
    rootID: SessionID,
    agentType: Schema.optional(Schema.String),
    background: Schema.Boolean,
    status: Status,
    time: Schema.optional(Interval),
  }).annotate({ identifier: "KilocodeWorktreeUsageSubagentEvent" })

  const CommunicationEvent = Schema.Struct({
    kind: Schema.Literal("communication"),
    id: Schema.String,
    channel: Schema.Literals(["board", "agent_manager"]),
    action: Schema.Literals(["post", "read", "prompt", "reply"]),
    sessionID: SessionID,
    rootID: SessionID,
    target: Schema.optional(Schema.String),
    replyTo: Schema.optional(Schema.String),
    bytes: Schema.optional(NonNegativeInt),
    messageType: Schema.optional(Schema.String),
    time: Interval,
  }).annotate({ identifier: "KilocodeWorktreeUsageCommunicationEvent" })

  export const TimelineEvent = Schema.Union([GenerationEvent, ToolEvent, SubagentEvent, CommunicationEvent]).annotate({
    identifier: "KilocodeWorktreeUsageTimelineEvent",
  })
  export type TimelineEvent = typeof TimelineEvent.Type

  export const Timeline = Schema.Struct({
    projectID: ProjectV2.ID,
    basis: Basis,
    worktree: Schema.Struct({ directory: Schema.String, kind: WorktreeKind }),
    events: Schema.Array(TimelineEvent),
    cursor: Schema.optional(Schema.String),
    hasMore: Schema.Boolean,
  }).annotate({ identifier: "KilocodeWorktreeUsageTimeline" })
  export type Timeline = typeof Timeline.Type

  export const InvalidCursorError = NamedError.create("WorktreeUsage.InvalidCursorError", {
    message: Schema.String,
  })
  export type InvalidCursorError = InstanceType<typeof InvalidCursorError>

  // ---------------------------------------------------------------------------
  // Internal row shapes
  // ---------------------------------------------------------------------------

  type SessionDbRow = {
    id: string
    parentID: string | null
    directory: string
    agent: string | null
    title: string
    createdAt: number
    archivedAt: number | null
  }

  type StepRow = {
    sessionID: string
    partID: string
    fallbackTime: number
    providerID: string | null
    modelID: string | null
    agent: string | null
    variant: string | null
    cost: number
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    timeStart: number | null
    timeEnd: number | null
    elapsed: number | null
  }

  type ToolRow = {
    sessionID: string
    partID: string
    fallbackTime: number
    tool: string
    status: "pending" | "running" | "completed" | "error"
    timeStart: number | null
    timeEnd: number | null
    childSessionID: string | null
    subagentType: string | null
    background: number | null
    amAction: string | null
    amTarget: string | null
    amReplyTo: string | null
  }

  type BoardRow = {
    id: string
    rootSessionID: string
    timeCreated: number
    senderSessionID: string
    recipient: string
    type: string
    replyTo: string | null
    bytes: number
  }

  // A worktree's owned session family: every session (root + descendants) whose
  // *current* root directory resolves into that worktree. Moving a root session
  // moves its whole subtree's economics (session-ownership attribution).
  type Family = {
    dirs: string[]
    primary: string
    // Non-git projects have no linked-worktree concept: every directory in the
    // (always single-entry) family is its own project, so it is reported as
    // "primary" rather than misleadingly "linked" against the unrelated global
    // project's sentinel worktree ("/").
    isGit: boolean
    byID: Map<string, SessionDbRow>
    children: Map<string, SessionDbRow[]>
    owner: Map<string, string>
    rootOf: Map<string, string>
    // worktree directory -> owned session ids (roots first, then by creation time)
    byDir: Map<string, string[]>
  }

  function kindOf(family: Family, dir: string): WorktreeKind {
    if (!family.isGit) return "primary"
    return dir === family.primary ? "primary" : "linked"
  }

  // ---------------------------------------------------------------------------
  // Small numeric/interval helpers
  // ---------------------------------------------------------------------------

  const CHUNK = 300

  function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
    return out
  }

  function clampInt(value: number | null | undefined): number {
    if (value == null || !Number.isFinite(value)) return 0
    return Math.max(0, Math.round(value))
  }

  function clampFinite(value: number | null | undefined): number {
    if (value == null || !Number.isFinite(value)) return 0
    return Math.max(0, value)
  }

  function resolveSafe(dir: string): string | undefined {
    try {
      return Filesystem.resolve(dir)
    } catch {
      return undefined
    }
  }

  // Longest-prefix match against the family's worktree roots. `dirs` are exact
  // worktree roots discovered via `git worktree list`, so containment alone
  // (no folder-naming heuristics) is enough to attribute a nested worktree
  // before the outer one.
  function ownerRoot(dirs: string[], directory: string): string | undefined {
    const resolved = resolveSafe(directory)
    if (resolved === undefined) return undefined
    const sorted = [...dirs].sort((a, b) => b.length - a.length)
    for (const root of sorted) {
      if (resolved === root || Filesystem.contains(root, resolved)) return root
    }
    return undefined
  }

  function unionMs(intervals: Array<[number, number]>): number {
    if (intervals.length === 0) return 0
    const sorted = [...intervals].sort((a, b) => a[0] - b[0])
    let total = 0
    let curStart = sorted[0][0]
    let curEnd = sorted[0][1]
    for (let i = 1; i < sorted.length; i++) {
      const [start, end] = sorted[i]
      if (start <= curEnd) {
        if (end > curEnd) curEnd = end
        continue
      }
      total += curEnd - curStart
      curStart = start
      curEnd = end
    }
    total += curEnd - curStart
    return total
  }

  // ---------------------------------------------------------------------------
  // Usage/time accumulation
  // ---------------------------------------------------------------------------

  type Accum = {
    steps: number
    cost: number
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    timedSteps: number
    totalSteps: number
    modelMs: number
    closedTools: number
    totalTools: number
    toolMs: number
    intervals: Array<[number, number]>
    first?: number
    last?: number
  }

  function newAccum(): Accum {
    return {
      steps: 0,
      cost: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      timedSteps: 0,
      totalSteps: 0,
      modelMs: 0,
      closedTools: 0,
      totalTools: 0,
      toolMs: 0,
      intervals: [],
    }
  }

  function touch(acc: Accum, t: number | null | undefined) {
    if (t == null) return
    if (acc.first === undefined || t < acc.first) acc.first = t
    if (acc.last === undefined || t > acc.last) acc.last = t
  }

  function addStep(acc: Accum, row: StepRow) {
    acc.steps++
    acc.totalSteps++
    acc.cost += clampFinite(row.cost)
    acc.input += clampInt(row.input)
    acc.output += clampInt(row.output)
    acc.reasoning += clampInt(row.reasoning)
    acc.cacheRead += clampInt(row.cacheRead)
    acc.cacheWrite += clampInt(row.cacheWrite)
    touch(acc, row.timeStart ?? row.fallbackTime)
    touch(acc, row.timeEnd)
    if (row.timeStart != null && row.timeEnd != null && row.timeEnd >= row.timeStart) {
      acc.timedSteps++
      const elapsed = row.elapsed != null && Number.isFinite(row.elapsed) ? Math.max(0, row.elapsed) : row.timeEnd - row.timeStart
      acc.modelMs += elapsed
      acc.intervals.push([row.timeStart, row.timeEnd])
    }
  }

  function addTool(acc: Accum, row: ToolRow) {
    acc.totalTools++
    touch(acc, row.timeStart ?? row.fallbackTime)
    touch(acc, row.timeEnd)
    if (row.timeStart != null && row.timeEnd != null && row.timeEnd >= row.timeStart) {
      acc.closedTools++
      acc.toolMs += row.timeEnd - row.timeStart
      acc.intervals.push([row.timeStart, row.timeEnd])
    }
  }

  function finalizeUsage(acc: Accum): Usage {
    return {
      steps: acc.steps,
      cost: acc.cost,
      tokens: {
        input: acc.input,
        output: acc.output,
        reasoning: acc.reasoning,
        cache: { read: acc.cacheRead, write: acc.cacheWrite },
      },
    }
  }

  function finalizeTime(acc: Accum, fallback?: number): Time {
    const first = acc.first ?? fallback
    const last = acc.last ?? fallback
    return {
      ...(first !== undefined ? { firstActivity: clampInt(first) } : {}),
      ...(last !== undefined ? { lastActivity: clampInt(last) } : {}),
      ...(first !== undefined && last !== undefined ? { wallMs: clampInt(last - first) } : {}),
      modelMs: clampInt(acc.modelMs),
      toolMs: clampInt(acc.toolMs),
      activeMs: clampInt(unionMs(acc.intervals)),
      coverage: {
        timedSteps: acc.timedSteps,
        totalSteps: acc.totalSteps,
        closedTools: acc.closedTools,
        totalTools: acc.totalTools,
      },
    }
  }

  type Communication = typeof Communication.Type
  type MutableCommunication = { -readonly [K in keyof Communication]: Communication[K] }

  function emptyCommunication(): MutableCommunication {
    return {
      boardPosts: 0,
      boardReads: 0,
      agentManagerPrompts: 0,
      agentManagerReplies: 0,
      boardBytes: 0,
      directCost: 0,
    }
  }

  function modelGroups(rows: StepRow[]): ModelGroup[] {
    const map = new Map<string, { providerID: string; modelID: string; variant?: string; acc: Accum }>()
    for (const row of rows) {
      if (!row.providerID || !row.modelID) continue
      const key = `${row.providerID}\u0000${row.modelID}\u0000${row.variant ?? ""}`
      const entry = map.get(key) ?? {
        providerID: row.providerID,
        modelID: row.modelID,
        variant: row.variant ?? undefined,
        acc: newAccum(),
      }
      addStep(entry.acc, row)
      map.set(key, entry)
    }
    return [...map.values()]
      .map(
        (entry): ModelGroup => ({
          providerID: ProviderV2.ID.make(entry.providerID),
          modelID: ModelV2.ID.make(entry.modelID),
          ...(entry.variant ? { variant: entry.variant } : {}),
          ...finalizeUsage(entry.acc),
        }),
      )
      .sort((a, b) => b.cost - a.cost)
  }

  function agentGroups(rows: StepRow[]): AgentGroup[] {
    const map = new Map<string, Accum>()
    for (const row of rows) {
      if (!row.agent) continue
      const acc = map.get(row.agent) ?? newAccum()
      addStep(acc, row)
      map.set(row.agent, acc)
    }
    return [...map.entries()]
      .map(([agent, acc]): AgentGroup => ({ agent, ...finalizeUsage(acc) }))
      .sort((a, b) => b.cost - a.cost)
  }

  // ---------------------------------------------------------------------------
  // Family / ownership resolution
  // ---------------------------------------------------------------------------

  const loadProjectIDs = Effect.fn("WorktreeUsage.loadProjectIDs")(function* (projectID: string, dirs: string[]) {
    const { db } = yield* Database.Service
    // Use the typed query builder (not a raw `sql` template) so Drizzle decodes
    // the JSON-mode `sandboxes` column into an array instead of leaving it as
    // the raw stored JSON text.
    const rows = yield* db
      .select({ id: ProjectTable.id, worktree: ProjectTable.worktree, sandboxes: ProjectTable.sandboxes })
      .from(ProjectTable)
      .all()
      .pipe(Effect.orDie)
    const set = new Set(dirs)
    const ids = new Set<string>([projectID])
    for (const row of rows) {
      if (row.id === projectID) continue
      const worktree = resolveSafe(row.worktree)
      const matchesWorktree = worktree !== undefined && set.has(worktree)
      const matchesSandbox = (row.sandboxes ?? []).some((sandbox) => {
        const resolved = resolveSafe(sandbox)
        return resolved !== undefined && set.has(resolved)
      })
      if (matchesWorktree || matchesSandbox) ids.add(row.id)
    }
    return [...ids]
  })

  const loadSessions = Effect.fn("WorktreeUsage.loadSessions")(function* (projectIDs: string[]) {
    const { db } = yield* Database.Service
    const rows: SessionDbRow[] = []
    for (const group of chunk(projectIDs, CHUNK)) {
      const part = yield* db
        .all<SessionDbRow>(
          sql`
          SELECT id, parent_id AS parentID, directory, agent, title, time_created AS createdAt, time_archived AS archivedAt
          FROM session
          WHERE project_id IN (${sql.join(
            group.map((id) => sql`${id}`),
            sql`,`,
          )})
        `,
        )
        .pipe(Effect.orDie)
      rows.push(...part)
    }
    return rows
  })

  function buildFamily(rows: SessionDbRow[], dirs: string[], primary: string, isGit: boolean): Family {
    const byID = new Map(rows.map((row) => [row.id, row]))
    const children = new Map<string, SessionDbRow[]>()
    for (const row of rows) {
      if (!row.parentID) continue
      const list = children.get(row.parentID) ?? []
      list.push(row)
      children.set(row.parentID, list)
    }
    const owner = new Map<string, string>()
    const rootOf = new Map<string, string>()
    const byDir = new Map<string, string[]>(dirs.map((dir) => [dir, []]))
    // A dangling parent reference (parent missing from this project's family)
    // is treated as its own root rather than dropped, so it is not silently
    // excluded from the report.
    const roots = rows.filter((row) => !row.parentID || !byID.has(row.parentID))
    for (const root of roots.sort((a, b) => a.createdAt - b.createdAt)) {
      const dir = ownerRoot(dirs, root.directory)
      if (!dir) continue
      const stack: SessionDbRow[] = [root]
      const owned: SessionDbRow[] = []
      while (stack.length > 0) {
        const current = stack.pop()!
        if (owner.has(current.id)) continue
        owner.set(current.id, dir)
        rootOf.set(current.id, root.id)
        owned.push(current)
        for (const child of children.get(current.id) ?? []) stack.push(child)
      }
      owned.sort((a, b) => a.createdAt - b.createdAt)
      byDir.set(dir, [...(byDir.get(dir) ?? []), ...owned.map((item) => item.id)])
    }
    return { dirs, primary, isGit, byID, children, owner, rootOf, byDir }
  }

  const resolveFamily = Effect.fn("WorktreeUsage.resolveFamily")(function* () {
    const ctx = yield* InstanceState.context
    const dirs = yield* WorktreeFamily.list()
    const primary = resolveSafe(ctx.project.worktree) ?? Filesystem.resolve(ctx.project.worktree)
    // Non-git projects share the sentinel `worktree: "/"` (and often the shared
    // "global" project id) across every unrelated directory on the machine, so
    // the routed worktree for `get()`/`timeline()` must come from `ctx.directory`
    // rather than `ctx.worktree` here, matching how `WorktreeFamily.list()` itself
    // falls back to `ctx.directory` for non-git projects.
    const current = ctx.project.vcs === "git" ? (resolveSafe(ctx.worktree) ?? Filesystem.resolve(ctx.worktree)) : (resolveSafe(ctx.directory) ?? Filesystem.resolve(ctx.directory))
    const projectIDs = yield* loadProjectIDs(ctx.project.id, dirs)
    const rows = yield* loadSessions(projectIDs)
    return { ctx, current, family: buildFamily(rows, dirs, primary, ctx.project.vcs === "git") }
  })

  // ---------------------------------------------------------------------------
  // Row loading for a concrete set of session ids
  // ---------------------------------------------------------------------------

  const loadStepRows = Effect.fn("WorktreeUsage.loadStepRows")(function* (ids: string[]) {
    const { db } = yield* Database.Service
    const rows: StepRow[] = []
    for (const group of chunk(ids, CHUNK)) {
      if (group.length === 0) continue
      const part = yield* db
        .all<StepRow>(
          sql`
          SELECT
            part.session_id AS sessionID,
            part.id AS partID,
            part.time_created AS fallbackTime,
            coalesce(json_extract(part.data, '$.model.providerID'), json_extract(message.data, '$.providerID')) AS providerID,
            coalesce(json_extract(part.data, '$.model.modelID'), json_extract(message.data, '$.modelID')) AS modelID,
            json_extract(message.data, '$.agent') AS agent,
            json_extract(message.data, '$.variant') AS variant,
            cast(coalesce(json_extract(part.data, '$.cost'), 0) AS REAL) AS cost,
            cast(coalesce(json_extract(part.data, '$.tokens.input'), 0) AS INTEGER) AS input,
            cast(coalesce(json_extract(part.data, '$.tokens.output'), 0) AS INTEGER) AS output,
            cast(coalesce(json_extract(part.data, '$.tokens.reasoning'), 0) AS INTEGER) AS reasoning,
            cast(coalesce(json_extract(part.data, '$.tokens.cache.read'), 0) AS INTEGER) AS cacheRead,
            cast(coalesce(json_extract(part.data, '$.tokens.cache.write'), 0) AS INTEGER) AS cacheWrite,
            json_extract(part.data, '$.time.start') AS timeStart,
            json_extract(part.data, '$.time.end') AS timeEnd,
            cast(json_extract(part.data, '$.time.elapsed') AS REAL) AS elapsed
          FROM part
          JOIN message ON message.id = part.message_id AND message.session_id = part.session_id
          WHERE part.session_id IN (${sql.join(
            group.map((id) => sql`${id}`),
            sql`,`,
          )})
            AND json_valid(part.data)
            AND json_extract(part.data, '$.type') = 'step-finish'
            AND json_extract(message.data, '$.role') = 'assistant'
        `,
        )
        .pipe(Effect.orDie)
      rows.push(...part)
    }
    return rows
  })

  const loadToolRows = Effect.fn("WorktreeUsage.loadToolRows")(function* (ids: string[]) {
    const { db } = yield* Database.Service
    const rows: ToolRow[] = []
    for (const group of chunk(ids, CHUNK)) {
      if (group.length === 0) continue
      const part = yield* db
        .all<ToolRow>(
          sql`
          SELECT
            part.session_id AS sessionID,
            part.id AS partID,
            part.time_created AS fallbackTime,
            json_extract(part.data, '$.tool') AS tool,
            json_extract(part.data, '$.state.status') AS status,
            json_extract(part.data, '$.state.time.start') AS timeStart,
            json_extract(part.data, '$.state.time.end') AS timeEnd,
            coalesce(
              json_extract(part.data, '$.metadata.sessionId'),
              json_extract(part.data, '$.state.metadata.sessionId')
            ) AS childSessionID,
            json_extract(part.data, '$.state.input.subagent_type') AS subagentType,
            json_extract(part.data, '$.state.metadata.background') AS background,
            json_extract(part.data, '$.state.metadata.action') AS amAction,
            json_extract(part.data, '$.state.metadata.sessionID') AS amTarget,
            json_extract(part.data, '$.state.metadata.replyTo') AS amReplyTo
          FROM part
          WHERE part.session_id IN (${sql.join(
            group.map((id) => sql`${id}`),
            sql`,`,
          )})
            AND json_valid(part.data)
            AND json_extract(part.data, '$.type') = 'tool'
        `,
        )
        .pipe(Effect.orDie)
      rows.push(...part)
    }
    return rows
  })

  const loadBoardRows = Effect.fn("WorktreeUsage.loadBoardRows")(function* (rootIDs: string[]) {
    const { db } = yield* Database.Service
    const rows: BoardRow[] = []
    for (const group of chunk(rootIDs, CHUNK)) {
      if (group.length === 0) continue
      const part = yield* db
        .all<BoardRow>(
          sql`
          SELECT
            id,
            board_root_session_id AS rootSessionID,
            time_created AS timeCreated,
            sender_session_id AS senderSessionID,
            recipient,
            type,
            reply_to AS replyTo,
            length(CAST(body AS BLOB)) AS bytes
          FROM kilo_board_message
          WHERE board_root_session_id IN (${sql.join(
            group.map((id) => sql`${id}`),
            sql`,`,
          )})
        `,
        )
        .pipe(Effect.orDie)
      rows.push(...part)
    }
    return rows
  })

  // ---------------------------------------------------------------------------
  // Summary aggregation shared by `summaries()` and `get()`
  // ---------------------------------------------------------------------------

  function buildSummary(input: {
    dir: string
    kind: WorktreeKind
    ids: string[]
    family: Family
    steps: StepRow[]
    tools: ToolRow[]
    board: BoardRow[]
  }): WorktreeSummary {
    const rootSessions = input.ids.filter((id) => input.family.rootOf.get(id) === id).length
    const subagents = input.ids.length - rootSessions
    const usage = newAccum()
    for (const row of input.steps) addStep(usage, row)
    for (const row of input.tools) addTool(usage, row)

    const communication = emptyCommunication()
    communication.boardPosts = input.board.length
    communication.boardBytes = input.board.reduce((sum, row) => sum + clampInt(row.bytes), 0)
    for (const row of input.board) touch(usage, row.timeCreated)
    for (const row of input.tools) {
      if (row.tool === "board_read") communication.boardReads++
      if (row.tool === "agent_manager" && row.amAction === "prompt") {
        if (row.amReplyTo) communication.agentManagerReplies++
        else communication.agentManagerPrompts++
      }
    }

    return {
      directory: input.dir,
      kind: input.kind,
      rootSessions,
      sessions: input.ids.length,
      subagents,
      totals: finalizeUsage(usage),
      time: finalizeTime(usage),
      communication,
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  export const summaries = Effect.fn("WorktreeUsage.summaries")(function* () {
    const { ctx, family } = yield* resolveFamily()
    const allIDs = [...family.owner.keys()]
    const [steps, tools, board] = yield* Effect.all([
      loadStepRows(allIDs),
      loadToolRows(allIDs),
      loadBoardRows([...new Set(family.rootOf.values())]),
    ])

    const stepsByDir = new Map<string, StepRow[]>()
    const toolsByDir = new Map<string, ToolRow[]>()
    const boardByDir = new Map<string, BoardRow[]>()
    for (const row of steps) {
      const dir = family.owner.get(row.sessionID)
      if (!dir) continue
      stepsByDir.set(dir, [...(stepsByDir.get(dir) ?? []), row])
    }
    for (const row of tools) {
      const dir = family.owner.get(row.sessionID)
      if (!dir) continue
      toolsByDir.set(dir, [...(toolsByDir.get(dir) ?? []), row])
    }
    for (const row of board) {
      const dir = family.owner.get(row.senderSessionID)
      if (!dir) continue
      boardByDir.set(dir, [...(boardByDir.get(dir) ?? []), row])
    }

    const worktrees = family.dirs.map((dir) =>
      buildSummary({
        dir,
        kind: kindOf(family, dir),
        ids: family.byDir.get(dir) ?? [],
        family,
        steps: stepsByDir.get(dir) ?? [],
        tools: toolsByDir.get(dir) ?? [],
        board: boardByDir.get(dir) ?? [],
      }),
    )

    return {
      projectID: ctx.project.id,
      basis: "retained",
      currency: "USD",
      asOf: Date.now(),
      worktrees,
    } satisfies Summaries
  })

  export const get = Effect.fn("WorktreeUsage.get")(function* () {
    const { ctx, current, family } = yield* resolveFamily()
    const dir = current
    const ids = family.byDir.get(dir) ?? []
    const [steps, tools, board] = yield* Effect.all([
      loadStepRows(ids),
      loadToolRows(ids),
      loadBoardRows([...new Set(ids.map((id) => family.rootOf.get(id)).filter((id): id is string => id !== undefined))]),
    ])

    const stepsBySession = new Map<string, StepRow[]>()
    const toolsBySession = new Map<string, ToolRow[]>()
    for (const row of steps) stepsBySession.set(row.sessionID, [...(stepsBySession.get(row.sessionID) ?? []), row])
    for (const row of tools) toolsBySession.set(row.sessionID, [...(toolsBySession.get(row.sessionID) ?? []), row])

    // Direct usage/time per session, then a post-order subtree rollup so
    // `subtree = direct + sum(children.subtree)` without re-querying parts.
    const direct = new Map<string, { usage: Usage; time: Time; models: ModelGroup[] }>()
    for (const id of ids) {
      const acc = newAccum()
      const sessionSteps = stepsBySession.get(id) ?? []
      for (const row of sessionSteps) addStep(acc, row)
      for (const row of toolsBySession.get(id) ?? []) addTool(acc, row)
      const session = family.byID.get(id)
      direct.set(id, {
        usage: finalizeUsage(acc),
        time: finalizeTime(acc, session?.createdAt),
        models: modelGroups(sessionSteps),
      })
    }

    const subtreeUsage = new Map<string, Usage>()
    const order = [...ids].reverse() // children were pushed after their parent while walking, so reversing approximates post-order
    const computeSubtree = (id: string): Usage => {
      const cached = subtreeUsage.get(id)
      if (cached) return cached
      const own = direct.get(id)?.usage ?? { steps: 0, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }
      const childRows = family.children.get(id) ?? []
      const total = childRows.reduce(
        (acc, child) => {
          if (!ids.includes(child.id)) return acc
          const childUsage = computeSubtree(child.id)
          return {
            steps: acc.steps + childUsage.steps,
            cost: acc.cost + childUsage.cost,
            tokens: {
              input: acc.tokens.input + childUsage.tokens.input,
              output: acc.tokens.output + childUsage.tokens.output,
              reasoning: acc.tokens.reasoning + childUsage.tokens.reasoning,
              cache: {
                read: acc.tokens.cache.read + childUsage.tokens.cache.read,
                write: acc.tokens.cache.write + childUsage.tokens.cache.write,
              },
            },
          }
        },
        own,
      )
      subtreeUsage.set(id, total)
      return total
    }
    for (const id of order) computeSubtree(id)

    const sessions: SessionRow[] = ids.map((id) => {
      const session = family.byID.get(id)!
      const info = direct.get(id)!
      return {
        id: SessionID.make(id),
        ...(session.parentID ? { parentID: SessionID.make(session.parentID) } : {}),
        rootID: SessionID.make(family.rootOf.get(id) ?? id),
        title: session.title,
        ...(session.agent ? { agent: session.agent } : {}),
        ...(session.archivedAt != null ? { archivedAt: clampInt(session.archivedAt) } : {}),
        createdAt: clampInt(session.createdAt),
        direct: info.usage,
        subtree: computeSubtree(id),
        models: info.models,
        time: info.time,
      }
    })

    const worktree = buildSummary({
      dir,
      kind: kindOf(family, dir),
      ids,
      family,
      steps,
      tools,
      board,
    })

    return {
      projectID: ctx.project.id,
      basis: "retained",
      currency: "USD",
      asOf: Date.now(),
      worktree,
      models: modelGroups(steps),
      agents: agentGroups(steps),
      sessions,
    } satisfies Detail
  })

  // ---------------------------------------------------------------------------
  // Timeline
  // ---------------------------------------------------------------------------

  type SortKey = [number, string]

  function isBefore(a: SortKey, b: SortKey): boolean {
    if (a[0] !== b[0]) return a[0] < b[0]
    return a[1] < b[1]
  }

  function compareDesc(a: SortKey, b: SortKey): number {
    if (a[0] !== b[0]) return b[0] - a[0]
    if (a[1] === b[1]) return 0
    return a[1] < b[1] ? 1 : -1
  }

  function encodeCursor(key: SortKey): string {
    return Buffer.from(JSON.stringify({ v: 1, start: key[0], id: key[1] })).toString("base64url")
  }

  function decodeCursor(raw: string): Effect.Effect<SortKey, InvalidCursorError> {
    return Effect.try({
      try: (): SortKey => {
        const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
        if (obj?.v !== 1 || typeof obj.start !== "number" || typeof obj.id !== "string") throw new Error("shape")
        return [obj.start, obj.id]
      },
      catch: () => new InvalidCursorError({ message: "Invalid or unsupported timeline cursor" }),
    })
  }

  function buildEvents(input: { family: Family; steps: StepRow[]; tools: ToolRow[]; board: BoardRow[] }): TimelineEvent[] {
    const rootOf = (sessionID: string) => SessionID.make(input.family.rootOf.get(sessionID) ?? sessionID)
    const events: TimelineEvent[] = []

    for (const row of input.steps) {
      const start = row.timeStart ?? row.fallbackTime
      events.push({
        kind: "generation",
        id: `gen:${row.partID}`,
        sessionID: SessionID.make(row.sessionID),
        rootID: rootOf(row.sessionID),
        ...(row.agent ? { agent: row.agent } : {}),
        ...(row.providerID ? { providerID: ProviderV2.ID.make(row.providerID) } : {}),
        ...(row.modelID ? { modelID: ModelV2.ID.make(row.modelID) } : {}),
        ...(row.variant ? { variant: row.variant } : {}),
        cost: clampFinite(row.cost),
        tokens: {
          input: clampInt(row.input),
          output: clampInt(row.output),
          reasoning: clampInt(row.reasoning),
          cache: { read: clampInt(row.cacheRead), write: clampInt(row.cacheWrite) },
        },
        time: { start: clampInt(start), ...(row.timeEnd != null ? { end: clampInt(row.timeEnd) } : {}) },
      })
    }

    for (const row of input.tools) {
      const start = row.timeStart ?? row.fallbackTime
      const time = { start: clampInt(start), ...(row.timeEnd != null ? { end: clampInt(row.timeEnd) } : {}) }

      if (row.tool === "board_post") continue // represented by the board table below, not duplicated here

      if (row.tool === "board_read") {
        events.push({
          kind: "communication",
          id: `board-read:${row.partID}`,
          channel: "board",
          action: "read",
          sessionID: SessionID.make(row.sessionID),
          rootID: rootOf(row.sessionID),
          time,
        })
        continue
      }

      if (row.tool === "agent_manager" && row.amAction === "prompt") {
        events.push({
          kind: "communication",
          id: `am:${row.partID}`,
          channel: "agent_manager",
          action: row.amReplyTo ? "reply" : "prompt",
          sessionID: SessionID.make(row.sessionID),
          rootID: rootOf(row.sessionID),
          ...(row.amTarget ? { target: row.amTarget } : {}),
          ...(row.amReplyTo ? { replyTo: row.amReplyTo } : {}),
          time,
        })
        continue
      }

      if (row.tool === "task" && row.childSessionID) {
        events.push({
          kind: "subagent",
          id: `task:${row.partID}`,
          parentSessionID: SessionID.make(row.sessionID),
          childSessionID: SessionID.make(row.childSessionID),
          rootID: rootOf(row.sessionID),
          ...(row.subagentType ? { agentType: row.subagentType } : {}),
          background: Boolean(row.background),
          status: row.status,
          time,
        })
        continue
      }

      events.push({
        kind: "tool",
        id: `tool:${row.partID}`,
        sessionID: SessionID.make(row.sessionID),
        rootID: rootOf(row.sessionID),
        tool: row.tool,
        status: row.status,
        time,
      })
    }

    for (const row of input.board) {
      events.push({
        kind: "communication",
        id: `board:${row.id}`,
        channel: "board",
        action: "post",
        sessionID: SessionID.make(row.senderSessionID),
        rootID: rootOf(row.senderSessionID),
        target: row.recipient,
        ...(row.replyTo ? { replyTo: row.replyTo } : {}),
        bytes: clampInt(row.bytes),
        messageType: row.type,
        time: { start: clampInt(row.timeCreated) },
      })
    }

    return events
  }

  function keyOf(event: TimelineEvent): SortKey {
    const start = "time" in event && event.time ? (event.time as { start: number }).start : 0
    return [start, event.id]
  }

  export const timeline = Effect.fn("WorktreeUsage.timeline")(function* (input: { before?: string; limit: number }) {
    const { ctx, current, family } = yield* resolveFamily()
    const cursor = input.before ? yield* decodeCursor(input.before) : undefined
    const dir = current
    const ids = family.byDir.get(dir) ?? []
    const rootIDs = [...new Set(ids.map((id) => family.rootOf.get(id)).filter((id): id is string => id !== undefined))]
    const [steps, tools, board] = yield* Effect.all([loadStepRows(ids), loadToolRows(ids), loadBoardRows(rootIDs)])

    const all = buildEvents({ family, steps, tools, board }).sort((a, b) => compareDesc(keyOf(a), keyOf(b)))
    const filtered = cursor ? all.filter((event) => isBefore(keyOf(event), cursor)) : all
    const page = filtered.slice(0, input.limit)
    const hasMore = filtered.length > page.length
    const last = page.at(-1)

    return {
      projectID: ctx.project.id,
      basis: "retained",
      worktree: { directory: dir, kind: kindOf(family, dir) },
      events: page,
      ...(hasMore && last ? { cursor: encodeCursor(keyOf(last)) } : {}),
      hasMore,
    } satisfies Timeline
  })
}
