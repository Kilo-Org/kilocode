// The `/periodic` wizard creates, edits and repairs managed Flows with one plugin dialog per step. The server asks
// for approval of a Flow's permissions with a normal permission prompt in a Session and validates the schedule only
// after that approval, so the steps check what they can first, and every call that can ask runs with the wizard closed
// and the approval Session shown.
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogPromptOptions, DialogSelectOption } from "@opencode/plugin/tui/context"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { KiloFlowPermissions } from "@opencode/schema/kilocode/flow-permissions"
import { KiloSchedule } from "@opencode/schema/kilocode/schedule"
import { Project } from "@opencode/schema/project"
import { Schedule } from "@opencode/schema/schedule"
import { Cron, DateTime, Option, Result, Schema } from "effect"
import { errorMessage } from "../util/error"

export type PeriodicContext = Pick<Plugin.Context, "client" | "data" | "keymap" | "renderer" | "theme" | "ui">
export type UpdateInput = (typeof KiloFlowRpc.UpdateInput)["Encoded"]
type CreateInput = (typeof KiloFlowRpc.CreateInput)["Encoded"]
type Dialog = Plugin.Context["ui"]["dialog"]

/** Where `/periodic` opens. */
export type Initial = {
  /** The Flow to select once the list loads. */
  readonly key?: string
  /** Opens the details of that Flow. */
  readonly detail?: boolean
  /** A change the dialog saves when it opens: an edit that needs no approval saves with `/periodic` open. */
  readonly save?: UpdateInput
}
export type Open = (initial?: Initial) => void

type Mode = "create" | "edit" | "repair"
type ScheduleType = Schedule.When["type"]
type End = { readonly type: "none" } | { readonly type: "times" | "at" | "after"; readonly value: string }

/** The answers of the wizard, also the prefill of its steps. */
export type Draft = {
  readonly prompt: string
  readonly name: string
  readonly schedule: { readonly type: ScheduleType; readonly value: string; readonly timezone: string }
  readonly worktree: "reuse" | "new"
  readonly end: End
  /** The permissions added to the read, glob and grep baseline every Flow receives. */
  readonly permissions: readonly KiloFlowRpc.PermissionGrant[]
}

type Step = {
  readonly title: string
  readonly description: string
  readonly placeholder: string
  readonly check: (value: string, timezone: string) => string | undefined
}

const headings: Record<Mode, string> = { create: "New Flow", edit: "Edit Flow", repair: "Repair Flow" }
const MINUTE = 60_000

type GrantAction = "shell" | "edit" | "webfetch" | "websearch" | "external_directory" | "read" | "glob" | "grep" | "other"

const grantActions: DialogSelectOption<GrantAction>[] = [
  { title: "shell", value: "shell", description: "Run commands" },
  { title: "edit", value: "edit", description: "Change files (write and patch too)" },
  { title: "webfetch", value: "webfetch", description: "Fetch URLs" },
  { title: "websearch", value: "websearch", description: "Search the web" },
  { title: "external_directory", value: "external_directory", description: "Use paths outside the Flow directory" },
  { title: "read", value: "read", description: "Read files (already allowed with *)" },
  { title: "glob", value: "glob", description: "List files (already allowed with *)" },
  { title: "grep", value: "grep", description: "Search file contents (already allowed with *)" },
  { title: "Other (MCP tool)…", value: "other", description: "A tool an MCP server exposes" },
]

// The resource domain of each action, the same wording the flow_create tool gives agents.
const grantHints: Record<GrantAction, { description: string; placeholder: string; value?: string }> = {
  shell: {
    description:
      "Command text, matched against each parsed command, such as npm test or taskctl *. Never a directory: add external_directory for paths outside the Flow directory.",
    placeholder: "npm test",
  },
  edit: { description: "File path or pattern in the Flow directory, such as reports/*.", placeholder: "reports/*" },
  webfetch: {
    description: "URL pattern; every redirect must match too, such as https://api.github.com/*.",
    placeholder: "https://api.github.com/*",
  },
  websearch: { description: "Search query pattern, such as *release notes*.", placeholder: "*" },
  external_directory: {
    description: "Bounded absolute directory wildcard outside the Flow directory, such as /home/me/data/*.",
    placeholder: "/home/me/data/*",
  },
  read: { description: "File path or pattern, such as docs/*.", placeholder: "docs/*" },
  glob: { description: "Pattern text the run may list, such as src/**/*.ts.", placeholder: "src/**/*.ts" },
  grep: { description: "Pattern text the run may search for.", placeholder: "TODO" },
  other: { description: "MCP tools currently request every resource, so use *.", placeholder: "*", value: "*" },
}

const scheduleOptions: DialogSelectOption<ScheduleType>[] = [
  { title: "Every", value: "every", description: "Repeat at a fixed interval" },
  { title: "Cron", value: "cron", description: "Repeat on a cron schedule" },
  { title: "At", value: "at", description: "Run once at a date and time" },
  { title: "In", value: "in", description: "Run once after a delay" },
]

const scheduleSteps: Record<ScheduleType, Step> = {
  every: {
    title: "Every",
    description: "Repeat interval of at least 1 minute, such as 30 minutes, 2 hours or 1 day.",
    placeholder: "1 day",
    check: (value) => duration(value) ?? (durationOf(value) < MINUTE ? "Repeat at most once a minute." : undefined),
  },
  cron: {
    title: "Cron",
    description: "Cron expression: minute, hour, day of month, month and day of week.",
    placeholder: "0 9 * * 1-5",
    check: cron,
  },
  at: {
    title: "At",
    description: "Date and time of the run in the Flow's time zone, such as 2026-12-31T09:00.",
    placeholder: "2026-12-31T09:00",
    check: (value, timezone) => {
      const at = Option.getOrUndefined(KiloSchedule.parseAt(value, timezone))
      if (at === undefined) return "Enter a date and time such as 2026-12-31T09:00."
      if (at <= Date.now()) return "Enter a time in the future."
    },
  },
  in: {
    title: "In",
    description: "Delay before the run, such as 20 minutes or 2 hours.",
    placeholder: "20 minutes",
    check: duration,
  },
}

const worktreeOptions: DialogSelectOption<Draft["worktree"]>[] = [
  { title: "Reuse the source directory", value: "reuse", description: "Each run works in the session's directory" },
  { title: "New worktree for each run", value: "new", description: "Each run works in a fresh git worktree" },
]

const endOptions: DialogSelectOption<End["type"]>[] = [
  { title: "No end", value: "none", description: "Repeat until paused or deleted" },
  { title: "After a number of runs", value: "times" },
  { title: "At a date and time", value: "at" },
  { title: "After a duration", value: "after" },
]

const endSteps: Record<Exclude<End["type"], "none">, Step> = {
  times: {
    title: "Runs",
    description: "Number of runs before the Flow ends.",
    placeholder: "10",
    check: (value) => (/^[1-9]\d*$/.test(value) ? undefined : "Enter a whole number of runs, such as 10."),
  },
  at: {
    title: "End time",
    description: "Date and time after which the Flow no longer runs, such as 2026-12-31T18:00.",
    placeholder: "2026-12-31T18:00",
    check: (value, timezone) =>
      Option.isNone(KiloSchedule.parseAt(value, timezone))
        ? "Enter a date and time such as 2026-12-31T18:00."
        : undefined,
  },
  after: {
    title: "Duration",
    description: "How long the Flow keeps running, such as 30 days.",
    placeholder: "30 days",
    check: duration,
  },
}

/**
 * Creates a Flow from a Session, or repairs `broken` by creating its replacement and then deleting it. Cancelling a
 * step reopens `/periodic` at `back`.
 */
export async function createFlow(
  context: PeriodicContext,
  open: Open,
  back: Initial,
  broken?: KiloFlowRpc.Info,
  timezone?: string,
) {
  const source = await sourceSession(context)
  if (!source) return open(back)
  const draft = await collect(
    context.ui.dialog,
    broken ? "repair" : "create",
    broken ? fromFlow(broken) : await fromSession(context, source.id, timezone),
  )
  if (!draft) return open(back)
  // One idempotency key per create intent: a retried request returns the Flow the first attempt created.
  return submitCreate(context, open, back, source, draft, broken, crypto.randomUUID().replaceAll("-", ""))
}

/**
 * Confirms and creates the Flow. A refused approval or a server rejection returns to the Permissions step with the
 * answers kept, so the allowlist can be fixed and submitted again. `requestID` is reused, so a retry after a lost
 * response returns the existing Flow instead of creating a duplicate.
 */
async function submitCreate(
  context: PeriodicContext,
  open: Open,
  back: Initial,
  source: { readonly id: string; readonly title: string },
  draft: Draft,
  broken: KiloFlowRpc.Info | undefined,
  requestID: string,
): Promise<void> {
  const confirmed = await context.ui.dialog.confirm({
    title: broken ? `Repair ${broken.name}?` : "Create Flow?",
    message: summary(draft, [
      `Source session: ${source.title}`,
      ...(broken ? ["The broken Flow is deleted once its replacement exists."] : []),
    ]),
    label: { confirm: broken ? "Repair" : "Create" },
  })
  if (!confirmed) return open(back)
  context.ui.dialog.clear()
  focus(context, source.id)
  context.ui.toast.show({ variant: "info", message: "Approve the Flow's permissions in the session to finish." })
  const rpc = context.client.rpc(KiloFlowRpc.Definition)
  let createFailure = ""
  let conflict: KiloFlowRpc.ID | undefined
  const created = await rpc
    .create(
      {
        sourceSessionID: source.id,
        requestID,
        ...createInput(draft),
        ...(broken?.context.model ? { model: broken.context.model } : {}),
        ...(broken?.context.agent ? { agent: broken.context.agent } : {}),
      },
      options(context),
    )
    .catch((cause: unknown) => {
      conflict = Option.getOrUndefined(Schema.decodeUnknownOption(ExistsError)(cause))?.data.flowID
      if (conflict) return undefined
      createFailure = errorMessage(cause)
      context.ui.toast.show({
        variant: "error",
        title: broken ? "Flow not repaired" : "Flow not created",
        message: createFailure,
      })
      return undefined
    })
  // An earlier attempt with this request id already created the Flow, with other settings than the draft now has.
  if (conflict) return resumeCreated(context, open, back, conflict, draft, broken)
  if (!created) {
    const permissions = await askPermissions(
      context.ui.dialog,
      stepTitle(broken ? "repair" : "create"),
      draft.permissions,
      "done",
      `not created: ${createFailure}`,
    )
    if (permissions === undefined) return open(back)
    return submitCreate(context, open, back, source, { ...draft, permissions }, broken, requestID)
  }
  await finishCreate(context, created, broken)
  open({ key: key(created) })
}

/** The `exists` error of `create`: the request id already created this Flow with different settings. */
const ExistsError = Schema.Struct({
  type: Schema.Literal("exists"),
  data: Schema.Struct({ flowID: KiloFlowRpc.ID }),
})

/**
 * Deletes the Flow a repair replaces, then reports the outcome of the create. `announce: false` skips the success toast
 * when the Flow was just saved as an edit, which already reported it.
 */
async function finishCreate(
  context: PeriodicContext,
  created: KiloFlowRpc.Info,
  broken: KiloFlowRpc.Info | undefined,
  announce = true,
) {
  const failure =
    broken?.reference.type === "managed"
      ? await context.client
          .rpc(KiloFlowRpc.Definition)
          .remove({ flowID: broken.reference.flowID }, options(context))
          .then(
            () => undefined,
            (cause: unknown) => errorMessage(cause),
          )
      : undefined
  if (failure)
    context.ui.toast.show({
      variant: "warning",
      title: "Broken Flow kept",
      message: `Created ${created.name}, but couldn't delete ${broken?.name}: ${failure}`,
    })
  if (!failure && announce)
    context.ui.toast.show({
      variant: "success",
      message: `${broken ? "Repaired" : "Created"} ${created.name}.${created.nextRunAt === undefined ? "" : ` Next run ${new Date(created.nextRunAt).toLocaleString()}.`}`,
    })
}

/**
 * A retry whose earlier attempt already created the Flow: the draft's differences become an edit of that Flow, with
 * the usual confirmation and, for a changed allowlist, a new approval. Never creates a second Flow.
 */
async function resumeCreated(
  context: PeriodicContext,
  open: Open,
  back: Initial,
  flowID: KiloFlowRpc.ID,
  draft: Draft,
  broken: KiloFlowRpc.Info | undefined,
) {
  const existing = await context.client
    .rpc(KiloFlowRpc.Definition)
    .list({}, options(context))
    .then(
      (output) =>
        output.flows.find((flow) => flow.reference.type === "managed" && flow.reference.flowID === flowID),
      () => undefined,
    )
  if (!existing) {
    context.ui.toast.show({
      variant: "error",
      title: broken ? "Flow not repaired" : "Flow not created",
      message: "An earlier attempt already created this Flow, but it couldn't be loaded. Check /periodic before creating it again.",
    })
    return open(back)
  }
  const initial = fromFlow(existing)
  if (Object.keys(changes(initial, draft)).length === 0) {
    await finishCreate(context, existing, broken)
    return open({ key: flowID })
  }
  const result = await submitEdit(
    context,
    open,
    existing,
    flowID,
    initial,
    draft,
    `${existing.name} was already created. Save your changes?`,
  )
  // The edit already reported the save; only a repair still has its broken Flow to delete.
  if (result === "saved") await finishCreate(context, existing, broken, false)
}

/**
 * Deletes a Flow after a choice whose first, preselected option is Cancel, so a stray key or Enter cannot remove a
 * scheduled task. The other options choose the scope: only the Flow, also its clean run worktrees (offered when it
 * left any behind), or also its run Sessions, which asks once more because their transcripts cannot be restored.
 * The source Session is never deleted.
 */
export async function deleteFlow(context: PeriodicContext, open: Open, flow: KiloFlowRpc.Info) {
  if (flow.reference.type !== "managed") return
  const flowID = flow.reference.flowID
  const back = { key: flowID, detail: true }
  const worktrees = await leftWorktrees(context, flow, flowID)
  context.ui.dialog.clear()
  // Cancel is first and preselected, so a stray Enter never deletes; deleting needs a deliberate choice.
  const choice = await context.ui.dialog.select({
    title: `Delete ${flow.name}?`,
    current: "cancel",
    options: [
      { title: "Cancel", value: "cancel" as const, description: "Keep the Flow" },
      {
        title: "Delete Flow",
        value: "flow" as const,
        description: "Remove the Flow, its schedule and run records. Run sessions and worktrees are kept.",
      },
      ...(worktrees
        ? [
            {
              title: "Delete Flow and clean worktrees",
              value: "worktrees" as const,
              description: "Also remove the run worktrees without changes. Run sessions are kept.",
            },
          ]
        : []),
      {
        title: worktrees ? "Delete Flow, run sessions and worktrees" : "Delete Flow and run sessions",
        value: "all" as const,
        description: worktrees
          ? "Also delete every run session and the run worktrees without changes. The source session is kept."
          : "Also delete every run session. The source session is kept.",
      },
    ],
  })
  if (choice === undefined || choice === "cancel") return open(back)
  if (choice === "all") {
    const confirmed = await context.ui.dialog.confirm({
      title: `Delete all run sessions of ${flow.name}?`,
      message: "Their transcripts are removed permanently. This cannot be undone.",
    })
    if (!confirmed) return open(back)
  }
  const removed = await context.client
    .rpc(KiloFlowRpc.Definition)
    .remove(
      {
        flowID,
        ...(choice === "worktrees" || (choice === "all" && worktrees) ? { deleteWorktrees: true } : {}),
        ...(choice === "all" ? { deleteSessions: true } : {}),
      },
      options(context),
    )
    .catch((cause: unknown) => {
      context.ui.toast.show({ variant: "error", title: "Delete failed", message: errorMessage(cause) })
      return undefined
    })
  if (!removed) return open(back)
  reportRemoval(context, flow.name, removed)
  open({})
}

/**
 * Whether the Flow runs in new worktrees or did before an edit: earlier runs still left worktrees behind, and the server
 * removes those too, so cleaning stays available after the Flow switches to reusing its directory.
 */
async function leftWorktrees(context: PeriodicContext, flow: KiloFlowRpc.Info, flowID: KiloFlowRpc.ID) {
  if (flow.execution.mode === "fresh" && flow.execution.worktree === "new") return true
  if (flow.latestRun?.worktree === "new") return true
  return context.client
    .rpc(KiloFlowRpc.Definition)
    .runs({ flowID }, options(context))
    .then(
      (output) => output.runs.some((run) => run.worktree === "new"),
      () => false,
    )
}

function reportRemoval(context: PeriodicContext, name: string, removed: KiloFlowRpc.RemoveOutput) {
  const sessions = removed.removedSessions?.length ?? 0
  const worktrees = removed.removedWorktrees?.length ?? 0
  const parts = [
    ...(sessions === 0 ? [] : [`${sessions} run session${sessions === 1 ? "" : "s"}`]),
    ...(worktrees === 0 ? [] : [`${worktrees} worktree${worktrees === 1 ? "" : "s"}`]),
  ]
  context.ui.toast.show({
    variant: "success",
    message: `Deleted ${name}.${parts.length === 0 ? "" : ` Removed ${parts.join(" and ")}.`}`,
  })
  const keptWorktrees = removed.keptWorktrees ?? []
  if (keptWorktrees.length > 0)
    context.ui.toast.show({
      variant: "warning",
      title: `Kept ${keptWorktrees.length} worktree${keptWorktrees.length === 1 ? "" : "s"} with changes`,
      message: keptWorktrees.join("\n"),
    })
  const keptSessions = removed.keptSessions ?? []
  if (keptSessions.length > 0)
    context.ui.toast.show({
      variant: "warning",
      title: `Couldn't delete ${keptSessions.length} run session${keptSessions.length === 1 ? "" : "s"}`,
      message: keptSessions.join("\n"),
    })
}

/**
 * Edits a managed Flow and sends only the changed fields. A changed allowlist is approved again, so that update runs
 * with `/periodic` closed and the approval Session shown; any other change saves in the reopened dialog.
 */
export async function editFlow(context: PeriodicContext, open: Open, flow: KiloFlowRpc.Info) {
  if (flow.reference.type !== "managed") return
  const flowID = flow.reference.flowID
  const back = { key: flowID, detail: true }
  const initial = fromFlow(flow)
  const draft = await collect(context.ui.dialog, "edit", initial)
  if (!draft) return open(back)
  return submitEdit(context, open, flow, flowID, initial, draft)
}

/**
 * Confirms and saves an edit. A rejected allowlist returns to the Permissions step with the other answers kept.
 * Resolves to `saved` once the change is submitted (a change without new permissions saves in the reopened dialog).
 */
async function submitEdit(
  context: PeriodicContext,
  open: Open,
  flow: KiloFlowRpc.Info,
  flowID: KiloFlowRpc.ID,
  initial: Draft,
  draft: Draft,
  title = `Save ${flow.name}?`,
): Promise<"saved" | "unchanged" | "cancelled"> {
  const back = { key: flowID, detail: true }
  const changed = changes(initial, draft)
  if (Object.keys(changed).length === 0) {
    context.ui.toast.show({ variant: "info", message: "No changes." })
    open(back)
    return "unchanged"
  }
  const confirmed = await context.ui.dialog.confirm({
    title,
    message: summary(draft, [
      ...(changed.permissions ? ["The new permissions apply once you approve them in the session."] : []),
      ...(changed.when || "ends" in changed ? ["The schedule restarts; run history is kept."] : []),
    ]),
    label: { confirm: "Save" },
  })
  if (!confirmed) {
    open(back)
    return "cancelled"
  }
  if (!changed.permissions) {
    open({ ...back, save: { flowID, ...changed } })
    return "saved"
  }
  const sessionID = approvalSession(context)
  context.ui.dialog.clear()
  if (!sessionID && flow.execution.mode === "fresh") focus(context, flow.execution.sourceSessionID)
  context.ui.toast.show({ variant: "info", message: "Approve the Flow's new permissions in the session to save." })
  let saveFailure = ""
  const saved = await context.client
    .rpc(KiloFlowRpc.Definition)
    .update({ flowID, ...changed, ...(sessionID ? { sessionID } : {}) }, options(context))
    .catch((cause: unknown) => {
      saveFailure = errorMessage(cause)
      context.ui.toast.show({ variant: "error", title: "Flow not saved", message: saveFailure })
      return undefined
    })
  if (!saved) {
    const permissions = await askPermissions(
      context.ui.dialog,
      stepTitle("edit"),
      draft.permissions,
      "done",
      `not saved: ${saveFailure}`,
    )
    if (permissions === undefined) {
      open(back)
      return "cancelled"
    }
    return submitEdit(context, open, flow, flowID, initial, { ...draft, permissions }, title)
  }
  context.ui.toast.show({ variant: "success", message: `Saved ${saved.name}.` })
  open(back)
  return "saved"
}

/**
 * The Session shown now asks for approval, unless it runs a Flow: a run Session denies every permission outside its
 * allowlist, so the request goes to the Flow's source Session instead.
 */
function approvalSession(context: PeriodicContext) {
  const route = context.ui.router.current()
  if (route.type !== "session") return
  if (context.data.session.get(route.sessionID)?.metadata?.[KiloFlowRpc.sessionMetadata] !== undefined) return
  return route.sessionID
}

/** The fields of an update that differ from the prefill; `ends: null` removes the limit. */
export function changes(initial: Draft, draft: Draft) {
  const scheduled =
    draft.schedule.type !== initial.schedule.type ||
    draft.schedule.value !== initial.schedule.value ||
    draft.schedule.timezone !== initial.schedule.timezone
  const ended = draft.end.type !== initial.end.type || endValue(draft.end) !== endValue(initial.end)
  const before = new Set(initial.permissions.map(permission))
  const permitted =
    draft.permissions.length !== initial.permissions.length ||
    draft.permissions.some((grant) => !before.has(permission(grant)))
  return {
    ...(draft.name !== initial.name ? { name: draft.name } : {}),
    ...(draft.prompt !== initial.prompt ? { prompt: draft.prompt } : {}),
    ...(scheduled ? { when: whenInput(draft.schedule) } : {}),
    ...(ended ? { ends: endsInput(draft.end) ?? null } : {}),
    ...(draft.worktree !== initial.worktree ? { worktree: draft.worktree } : {}),
    ...(permitted ? { permissions: draft.permissions } : {}),
  }
}

/** The prefill for editing or repairing a Flow: its frozen definition, without the baseline permissions. */
export function fromFlow(flow: KiloFlowRpc.Info): Draft {
  return {
    prompt: flow.prompt.trim(),
    name: flow.name.trim(),
    schedule: {
      type: flow.trigger.when.type,
      value: scheduleValue(flow.trigger.when),
      timezone: flow.trigger.timezone,
    },
    worktree: flow.execution.mode === "fresh" ? flow.execution.worktree : "reuse",
    end: endOf(flow.ends),
    permissions: additional(flow.permissions ?? []),
  }
}

/** A short Flow name from the first line of its prompt. */
export function deriveName(prompt: string) {
  const line = (prompt.split("\n").find((part) => part.trim().length > 0) ?? "").trim().replace(/\s+/g, " ")
  if (line.length <= 40) return line
  const cut = line.slice(0, 40)
  const space = cut.lastIndexOf(" ")
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The permissions a Flow holds beyond the baseline every Flow receives. */
export function additional(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  return permissions.filter((grant) => !KiloFlowPermissions.inBaseline(grant))
}

export function permission(grant: KiloFlowRpc.PermissionGrant) {
  return `${grant.action}: ${grant.resource}`
}

export function key(flow: KiloFlowRpc.Info) {
  return flow.reference.type === "managed" ? flow.reference.flowID : flow.reference.scheduleID
}

export function trigger(value: KiloFlowRpc.Trigger) {
  const schedule = `${capitalize(value.when.type)} ${scheduleValue(value.when)}`
  if (value.type === "time") return schedule
  return `Poll ${schedule.toLowerCase()} (${value.mode}, ${value.condition.type})`
}

/** The limits of `ends`, joined by "or": a repeating schedule stops at the first one reached. */
export function endsLabel(value: Schedule.Ends) {
  const limits = [
    value.times === undefined ? undefined : `after ${value.times} run${value.times === 1 ? "" : "s"}`,
    value.after === undefined ? undefined : `after ${value.after}`,
    value.at === undefined ? undefined : `at ${value.at}`,
  ].filter((limit): limit is string => limit !== undefined)
  if (limits.length === 0) return undefined
  return capitalize(limits.join(" or "))
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Shows a Session: its tab when tabs are enabled, otherwise the Session route. */
export function focus(context: Pick<PeriodicContext, "ui">, sessionID: string) {
  const route = context.ui.router.current()
  if (route.type === "session" && route.sessionID === sessionID) return
  if (context.ui.tabs.focus(sessionID)) return
  context.ui.router.navigate({ type: "session", sessionID })
}

/** Flows belong to the launch project, so every call uses the launch location. */
export function options(context: Pick<PeriodicContext, "data">) {
  return { location: { directory: context.data.location.default().directory } }
}

function stepTitle(mode: Mode) {
  return (step: string) => `${headings[mode]} · ${step}`
}

async function collect(dialog: Dialog, mode: Mode, draft: Draft): Promise<Draft | undefined> {
  const title = stepTitle(mode)
  const prompt = await ask(
    dialog,
    {
      title: title("Prompt"),
      description: "Each run sends this prompt to a fresh session.",
      placeholder: "What should each run do?",
      value: draft.prompt,
    },
    required("Enter the prompt each run sends."),
  )
  if (prompt === undefined) return
  const name = await ask(
    dialog,
    { title: title("Name"), description: "Shown in /periodic.", value: draft.name || deriveName(prompt) },
    required("Enter a name."),
  )
  if (name === undefined) return
  const type = await dialog.select({ title: title("Schedule"), options: scheduleOptions, current: draft.schedule.type })
  if (type === undefined) return
  const step = scheduleSteps[type]
  const value = await ask(
    dialog,
    {
      title: title(step.title),
      description: step.description,
      placeholder: step.placeholder,
      value: type === draft.schedule.type ? draft.schedule.value : undefined,
    },
    (text) => step.check(text, draft.schedule.timezone),
  )
  if (value === undefined) return
  const timezone = await ask(
    dialog,
    {
      title: title("Time zone"),
      description: "IANA time zone of the schedule, such as Europe/Berlin.",
      value: draft.schedule.timezone,
    },
    (zone) => (Option.isSome(DateTime.zoneMakeNamed(zone)) ? undefined : `Unknown time zone: ${zone || "(empty)"}`),
  )
  if (timezone === undefined) return
  // The value was checked in the prefilled zone; the final one decides how the server reads a wall-clock time, so a
  // value that only the old zone accepted is asked for again.
  const confirmed =
    step.check(value, timezone) === undefined
      ? value
      : await ask(
          dialog,
          { title: title(step.title), description: step.description, placeholder: step.placeholder, value },
          (text) => step.check(text, timezone),
        )
  if (confirmed === undefined) return
  const worktree = await dialog.select({ title: title("Worktree"), options: worktreeOptions, current: draft.worktree })
  if (worktree === undefined) return
  // A single run has nothing to stop.
  const end = type === "at" || type === "in" ? { type: "none" as const } : await askEnd(dialog, title, draft.end, timezone)
  if (end === undefined) return
  const permissions = await askPermissions(dialog, title, draft.permissions)
  if (permissions === undefined) return
  return { prompt, name, schedule: { type, value: confirmed, timezone }, worktree, end, permissions }
}

/**
 * The permission rows: the baseline every Flow holds, one row per additional grant, then Add and Done. Choosing a grant
 * offers to edit or delete it; cancelling a nested step returns to the rows, and cancelling the rows cancels the wizard.
 */
export async function askPermissions(
  dialog: Dialog,
  title: (step: string) => string,
  grants: readonly KiloFlowRpc.PermissionGrant[],
  current: string = "done",
  notice?: string,
): Promise<readonly KiloFlowRpc.PermissionGrant[] | undefined> {
  const choice = await dialog.select({
    title: notice === undefined ? title("Permissions") : `${title("Permissions")} · ${notice}`,
    options: permissionRows(grants),
    current,
  })
  if (choice === undefined) return
  if (choice === "done") return grants
  if (choice === "baseline") return askPermissions(dialog, title, grants, choice, notice)
  if (choice === "add") {
    const added = await askGrant(dialog, title, grants)
    if (!added) return askPermissions(dialog, title, grants, "add", notice)
    return askPermissions(dialog, title, [...grants, added], `grant:${grants.length}`, notice)
  }
  const index = Number(choice.slice("grant:".length))
  const others = grants.filter((_, position) => position !== index)
  const operation = await dialog.select({
    title: title(permission(grants[index])),
    options: [
      { title: "Edit", value: "edit" as const, description: "Change the action or the resource" },
      { title: "Delete", value: "delete" as const, description: "Remove this permission" },
    ],
  })
  if (operation === "delete") return askPermissions(dialog, title, others, "add", notice)
  const edited = operation === "edit" ? await askGrant(dialog, title, others, grants[index]) : undefined
  const next = edited ? grants.map((grant, position) => (position === index ? edited : grant)) : grants
  return askPermissions(dialog, title, next, choice, notice)
}

function permissionRows(grants: readonly KiloFlowRpc.PermissionGrant[]): DialogSelectOption<string>[] {
  return [
    ...KiloFlowPermissions.baseline.map((grant) => ({
      title: permission(grant),
      value: "baseline",
      category: "Always included",
      description: "Every Flow can read and search its directory",
    })),
    ...grants.map((grant, index) => ({
      title: permission(grant),
      value: `grant:${index}`,
      category: "Additional",
      description: "Choose to edit or delete",
    })),
    { title: "Add permission…", value: "add", category: "Actions", description: "Allow another tool unattended" },
    {
      title: "Done",
      value: "done",
      category: "Actions",
      description:
        grants.length === 0 ? "Only the baseline" : `${grants.length} additional permission${grants.length === 1 ? "" : "s"}`,
    },
  ]
}

/** Asks for one grant's action, then its resource, checked with the server's rules; undefined when cancelled. */
async function askGrant(
  dialog: Dialog,
  title: (step: string) => string,
  others: readonly KiloFlowRpc.PermissionGrant[],
  existing?: KiloFlowRpc.PermissionGrant,
): Promise<KiloFlowRpc.PermissionGrant | undefined> {
  const known = (action: string): action is GrantAction => Object.hasOwn(grantHints, action) && action !== "other"
  const choice = await dialog.select({
    title: title("Permission action"),
    options: grantActions,
    current: existing ? (known(existing.action) ? existing.action : "other") : undefined,
  })
  if (choice === undefined) return
  const action =
    choice === "other"
      ? await ask(
          dialog,
          {
            title: title("MCP tool"),
            description: "Name of the MCP tool as the model sees it, such as github_create_issue.",
            value: existing && !known(existing.action) ? existing.action : undefined,
          },
          (value) =>
            /^\S+$/.test(value)
              ? KiloFlowPermissions.check({ action: value, resource: "*" })
              : "Enter one tool name without spaces.",
        )
      : choice
  if (action === undefined) return
  const hint = grantHints[choice]
  const resource = await ask(
    dialog,
    {
      title: title(`${action} resource`),
      description: hint.description,
      placeholder: hint.placeholder,
      value: existing?.action === action ? existing.resource : hint.value,
    },
    (value) => grantProblem({ action, resource: value }, others),
  )
  if (resource === undefined) return
  return { action, resource }
}

function grantProblem(grant: KiloFlowRpc.PermissionGrant, others: readonly KiloFlowRpc.PermissionGrant[]) {
  if (grant.resource.length === 0) return "Enter a resource pattern."
  const problem = KiloFlowPermissions.check(grant)
  if (problem) return problem
  if (KiloFlowPermissions.inBaseline(grant)) return `${permission(grant)} is always included.`
  if (others.some((other) => other.action === grant.action && other.resource === grant.resource))
    return `${permission(grant)} is already in the list.`
}

async function askEnd(
  dialog: Dialog,
  title: (step: string) => string,
  current: End,
  timezone: string,
): Promise<End | undefined> {
  const type = await dialog.select({ title: title("End"), options: endOptions, current: current.type })
  if (type === undefined) return
  if (type === "none") return { type }
  const step = endSteps[type]
  const value = await ask(
    dialog,
    {
      title: title(step.title),
      description: step.description,
      placeholder: step.placeholder,
      value: current.type === type ? current.value : undefined,
    },
    (text) => step.check(text, timezone),
  )
  if (value === undefined) return
  return { type, value }
}

/** Asks again, with the problem in place of the description, until the answer passes `check` or the step is cancelled. */
async function ask(
  dialog: Dialog,
  prompt: DialogPromptOptions,
  check: (value: string) => string | undefined,
): Promise<string | undefined> {
  const text = await dialog.prompt(prompt)
  if (text === undefined) return
  const problem = check(text.trim())
  if (problem === undefined) return text.trim()
  return ask(dialog, { ...prompt, value: text, description: problem }, check)
}

async function sourceSession(context: PeriodicContext) {
  const route = context.ui.router.current()
  if (route.type === "session")
    return { id: route.sessionID, title: context.data.session.get(route.sessionID)?.title || route.sessionID }
  const sessions = await recentSessions(context)
  if (sessions.length === 0) {
    await context.ui.dialog.alert({
      title: "No sessions",
      message: "A Flow starts from a session. Open the session whose task should repeat, then press n in /periodic.",
    })
    return
  }
  const id = await context.ui.dialog.select({
    title: "Source session",
    options: sessions.map((session) => ({
      title: session.title || session.id,
      value: session.id,
      description: new Date(session.time.updated).toLocaleString(),
    })),
  })
  if (id === undefined) return
  return { id, title: sessions.find((session) => session.id === id)?.title || id }
}

/** The project's most recent root sessions; outside version control, those of the launch directory. */
async function recentSessions(context: PeriodicContext) {
  const location = options(context).location
  const info = await context.client.location.get({ location }).catch(() => undefined)
  return context.client.session
    .list({
      ...(info && info.project.id !== Project.ID.global
        ? { project: info.project.id }
        : { directory: location.directory }),
      limit: 20,
      order: "desc",
      parentID: null,
      archived: false,
    })
    .then(
      (response) => response.data,
      () => [],
    )
}

async function fromSession(context: PeriodicContext, sessionID: string, timezone?: string): Promise<Draft> {
  await context.data.session.message.sync(sessionID).catch(() => undefined)
  const zone = timezone && Option.isSome(DateTime.zoneMakeNamed(timezone)) ? timezone : undefined
  return {
    prompt: (
      context.data.session.message
        .list(sessionID)
        .flatMap((message) => (message.type === "user" ? [message.text] : []))
        .at(-1) ?? ""
    ).trim(),
    name: "",
    schedule: { type: "every", value: "1 day", timezone: zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone },
    worktree: "reuse",
    end: { type: "none" },
    permissions: [],
  }
}

function summary(draft: Draft, notes: readonly string[]) {
  const ends = endsInput(draft.end)
  return [
    `Name: ${draft.name}`,
    `Schedule: ${capitalize(draft.schedule.type)} ${draft.schedule.value} (${draft.schedule.timezone})`,
    `Worktree: ${draft.worktree === "new" ? "new worktree for each run" : "reuse the source directory"}`,
    ...(ends ? [`Ends: ${endsLabel(ends)}`] : []),
    `Permissions: read, glob and grep${draft.permissions.length === 0 ? "" : `, plus ${draft.permissions.map(permission).join(", ")}`}`,
    `Prompt: ${draft.prompt.split("\n")[0]}`,
    ...notes,
  ].join("\n")
}

function createInput(draft: Draft) {
  const ends = endsInput(draft.end)
  return {
    name: draft.name,
    prompt: draft.prompt,
    when: whenInput(draft.schedule),
    worktree: draft.worktree,
    permissions: draft.permissions,
    ...(ends ? { ends } : {}),
  }
}

function whenInput(schedule: Draft["schedule"]): CreateInput["when"] {
  if (schedule.type === "every") return { every: schedule.value, tz: schedule.timezone }
  if (schedule.type === "cron") return { cron: schedule.value, tz: schedule.timezone }
  if (schedule.type === "at") return { at: schedule.value, tz: schedule.timezone }
  return { in: schedule.value, tz: schedule.timezone }
}

function endsInput(end: End): CreateInput["ends"] {
  if (end.type === "none") return undefined
  if (end.type === "times") return { times: Number(end.value) }
  if (end.type === "at") return { at: end.value }
  return { after: end.value }
}

/** The wizard sets one limit; a combination written by an agent shows its first limit and stays unless edited. */
function endOf(ends: Schedule.Ends | undefined): End {
  if (ends?.times !== undefined) return { type: "times", value: String(ends.times) }
  if (ends?.at !== undefined) return { type: "at", value: ends.at }
  if (ends?.after !== undefined) return { type: "after", value: ends.after }
  return { type: "none" }
}

function endValue(end: End) {
  return end.type === "none" ? "" : end.value
}

function scheduleValue(value: Schedule.When) {
  if (value.type === "every") return value.every
  if (value.type === "cron") return value.cron
  if (value.type === "at") return value.at
  return value.in
}

function required(message: string) {
  return (value: string) => (value.length > 0 ? undefined : message)
}

function durationOf(value: string) {
  return Option.getOrElse(Schedule.durationMillis(value), () => 0)
}

function duration(value: string) {
  if (durationOf(value) > 0) return undefined
  return "Enter a duration such as 30 minutes, 2 hours or 1 day."
}

// The same rules the schedule service applies once the Flow is approved.
function cron(value: string) {
  const parsed = Cron.parse(value)
  if (Result.isFailure(parsed)) return `Invalid cron expression: ${parsed.failure.message}`
  if (parsed.success.seconds.size !== 1) return "A cron Flow runs at most once a minute."
}
