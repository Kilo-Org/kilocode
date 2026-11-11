// The `/periodic` wizard creates, edits and repairs managed Flows with one plugin dialog per step. The server asks
// for approval of a Flow's permissions with a normal permission prompt in a Session and validates the schedule only
// after that approval, so the steps check what they can first, and every call that can ask runs with the wizard closed
// and the approval Session shown.
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogPromptOptions, DialogSelectOption } from "@opencode/plugin/tui/context"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { KiloSchedule } from "@opencode/schema/kilocode/schedule"
import { Project } from "@opencode/schema/project"
import { Schedule } from "@opencode/schema/schedule"
import { Cron, DateTime, Option, Result } from "effect"
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
const baseline = ["read", "glob", "grep"]
const MINUTE = 60_000

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
export async function createFlow(context: PeriodicContext, open: Open, back: Initial, broken?: KiloFlowRpc.Info) {
  const source = await sourceSession(context)
  if (!source) return open(back)
  const draft = await collect(
    context.ui.dialog,
    broken ? "repair" : "create",
    broken ? fromFlow(broken) : await fromSession(context, source.id),
  )
  if (!draft) return open(back)
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
  const created = await rpc
    .create(
      {
        sourceSessionID: source.id,
        ...createInput(draft),
        ...(broken?.context.model ? { model: broken.context.model } : {}),
        ...(broken?.context.agent ? { agent: broken.context.agent } : {}),
      },
      options(context),
    )
    .catch((cause: unknown) => {
      context.ui.toast.show({
        variant: "error",
        title: broken ? "Flow not repaired" : "Flow not created",
        message: errorMessage(cause),
      })
      return undefined
    })
  if (!created) return
  const failure =
    broken?.reference.type === "managed"
      ? await rpc.remove({ flowID: broken.reference.flowID }, options(context)).then(
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
  if (!failure)
    context.ui.toast.show({
      variant: "success",
      message: `${broken ? "Repaired" : "Created"} ${created.name}.${created.nextRunAt === undefined ? "" : ` Next run ${new Date(created.nextRunAt).toLocaleString()}.`}`,
    })
  open({ key: key(created) })
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
  const changed = changes(initial, draft)
  if (Object.keys(changed).length === 0) {
    context.ui.toast.show({ variant: "info", message: "No changes." })
    return open(back)
  }
  const confirmed = await context.ui.dialog.confirm({
    title: `Save ${flow.name}?`,
    message: summary(draft, [
      ...(changed.permissions ? ["The new permissions apply once you approve them in the session."] : []),
      ...(changed.when || "ends" in changed ? ["The schedule restarts; run history is kept."] : []),
    ]),
    label: { confirm: "Save" },
  })
  if (!confirmed) return open(back)
  if (!changed.permissions) return open({ ...back, save: { flowID, ...changed } })
  const route = context.ui.router.current()
  const sessionID = route.type === "session" ? route.sessionID : undefined
  context.ui.dialog.clear()
  if (!sessionID && flow.execution.mode === "fresh") focus(context, flow.execution.sourceSessionID)
  context.ui.toast.show({ variant: "info", message: "Approve the Flow's new permissions in the session to save." })
  const saved = await context.client
    .rpc(KiloFlowRpc.Definition)
    .update({ flowID, ...changed, ...(sessionID ? { sessionID } : {}) }, options(context))
    .catch((cause: unknown) => {
      context.ui.toast.show({ variant: "error", title: "Flow not saved", message: errorMessage(cause) })
      return undefined
    })
  if (!saved) return
  context.ui.toast.show({ variant: "success", message: `Saved ${saved.name}.` })
  open(back)
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

/** Parses `action: resource` entries, one per line or comma-separated. */
export function parsePermissions(text: string) {
  const entries = text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const invalid = entries.find((entry) => !/^[^\s:]+\s*:\s*\S/.test(entry))
  const grants = additional(
    entries.map((entry) => ({
      action: entry.slice(0, entry.indexOf(":")).trim(),
      resource: entry.slice(entry.indexOf(":") + 1).trim(),
    })),
  )
  return {
    error: invalid === undefined ? undefined : `Use action: resource, such as shell: npm test. Not valid: ${invalid}`,
    permissions: grants.filter(
      (grant, index) =>
        grants.findIndex((item) => item.action === grant.action && item.resource === grant.resource) === index,
    ),
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
  return permissions.filter((grant) => grant.resource !== "*" || !baseline.includes(grant.action))
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

async function collect(dialog: Dialog, mode: Mode, draft: Draft): Promise<Draft | undefined> {
  const title = (step: string) => `${headings[mode]} · ${step}`
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
  const text = await ask(
    dialog,
    {
      title: title("Permissions"),
      description:
        "Additional unattended permissions as action: resource, comma-separated. read, glob and grep are always included. Leave empty for none.",
      placeholder: "shell: npm test, edit: reports/*",
      value: draft.permissions.map(permission).join(", "),
    },
    (input) => parsePermissions(input).error,
  )
  if (text === undefined) return
  return {
    prompt,
    name,
    schedule: { type, value: confirmed, timezone },
    worktree,
    end,
    permissions: parsePermissions(text).permissions,
  }
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

async function fromSession(context: PeriodicContext, sessionID: string): Promise<Draft> {
  await context.data.session.message.sync(sessionID).catch(() => undefined)
  return {
    prompt: (
      context.data.session.message
        .list(sessionID)
        .flatMap((message) => (message.type === "user" ? [message.text] : []))
        .at(-1) ?? ""
    ).trim(),
    name: "",
    schedule: { type: "every", value: "1 day", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
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
