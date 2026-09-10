import { Plugin } from "@opencode-ai/plugin/tui"
import { Option, Schema } from "effect"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"

const ghProbeTtl = 300_000
// v1's Process.spawn semantics: the lookup carries one abort budget (the 20s
// deadline below); a firing abort SIGTERMs the child, and this is the kill
// grace before a lingering child is SIGKILLed. It is not a per-command limit.
const abortKillGrace = 1_000
const lookupDeadline = 20_000

let ghPath: string | null | undefined
let ghProbedAt = 0

// The probe result is cached for the v1 5-minute window, and the resolved
// executable is what every gh spawn uses — gh is never re-resolved mid-lookup.
// PATH is passed explicitly because Bun caches the boot-time PATH for bare
// lookups, so a mutated environment would be ignored.
function probeGh() {
  const now = Date.now()
  if (ghPath !== undefined && now - ghProbedAt < ghProbeTtl) return ghPath
  ghPath = Bun.which("gh", { PATH: process.env.PATH }) ?? null
  ghProbedAt = now
  return ghPath
}

export type Pr = { readonly number: number; readonly title: string }

// gh's actual record shapes; anything else fails closed to "no PR".
const GhPrView = Schema.Struct({ number: Schema.Number, title: Schema.String })
const GhPrListEntry = Schema.Struct({ number: Schema.Number, title: Schema.String, headRefOid: Schema.String })
const GhRepo = Schema.Struct({
  nameWithOwner: Schema.optional(Schema.String),
  parent: Schema.optional(
    Schema.Struct({
      nameWithOwner: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      owner: Schema.optional(Schema.Struct({ login: Schema.optional(Schema.String) })),
    }),
  ),
})

const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeView = Schema.decodeUnknownOption(GhPrView)
const decodeList = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))
const decodeEntry = Schema.decodeUnknownOption(GhPrListEntry)
const decodeRepo = Schema.decodeUnknownOption(GhRepo)

function parseJson(input: string): unknown {
  const parsed = fromJson(input)
  return Option.isNone(parsed) ? null : parsed.value
}

/** The tracking-ref/branch view payload: both fields required, as gh emits. */
export function parsePr(text: string): Pr | null {
  const parsed = parseJson(text)
  if (parsed === null) return null
  return Option.getOrUndefined(decodeView(parsed)) ?? null
}

/** Only a PR whose head commit matches ours exactly is ours; a PR that merely
 * references the SHA in its title or body must never render. Entries are
 * validated one at a time and malformed ones are skipped, so a bad entry
 * cannot shadow a later valid candidate. */
export function selectPr(text: string, head: string): Pr | null {
  const parsed = parseJson(text)
  if (parsed === null) return null
  const entries = Option.getOrUndefined(decodeList(parsed))
  if (!entries) return null
  for (const entry of entries) {
    const record = Option.getOrUndefined(decodeEntry(entry))
    if (!record) continue
    if (record.headRefOid !== head) continue
    return { number: record.number, title: record.title }
  }
  return null
}

/** The fork parent repository name, only when it differs from the checked-out
 * repository itself. */
export function parseRepo(text: string): string | null {
  const parsed = parseJson(text)
  if (parsed === null) return null
  const repo = Option.getOrUndefined(decodeRepo(parsed))
  if (!repo?.nameWithOwner) return null
  const parent = repo.parent
  if (!parent) return null
  const forked =
    parent.nameWithOwner ??
    (parent.owner?.login !== undefined && parent.name !== undefined ? `${parent.owner.login}/${parent.name}` : null)
  if (!forked || forked === repo.nameWithOwner) return null
  return forked
}

/** One gh/git invocation inside the lookup's abort budget. Stopping the child
 * is one consolidated path — abort and read failure both SIGTERM it, and one
 * retained timer escalates to SIGKILL after v1's kill grace — with the child's
 * exit awaited on every path, so the owned child never outlives the call. */
export async function runText(command: string[], cwd: string, signal: AbortSignal) {
  const child = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    signal,
  })
  let escalation: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill()
    if (escalation === undefined) {
      escalation = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill(9)
      }, abortKillGrace)
    }
  }
  signal.addEventListener("abort", stop, { once: true })
  try {
    const output = await new Response(child.stdout).text()
    await child.exited
    return { code: child.exitCode ?? -1, output: output.trim() }
  } catch {
    stop()
    await child.exited.catch(() => undefined)
    return { code: -1, output: "" }
  } finally {
    signal.removeEventListener("abort", stop)
    if (escalation !== undefined) clearTimeout(escalation)
  }
}

async function lookupView(gh: string, cwd: string, branch: string, signal: AbortSignal) {
  const commands = [
    [gh, "pr", "view", "--json", "number,title"],
    [gh, "pr", "view", branch, "--json", "number,title"],
  ]
  for (const command of commands) {
    const result = await runText(command, cwd, signal)
    if (result.code !== 0 || !result.output) continue
    const found = parsePr(result.output)
    if (found) return found
  }
  return null
}

async function lookupHead(cwd: string, signal: AbortSignal) {
  const result = await runText(["git", "rev-parse", "HEAD"], cwd, signal)
  return result.code === 0 && result.output ? result.output : null
}

async function lookupParent(gh: string, cwd: string, signal: AbortSignal) {
  const result = await runText([gh, "repo", "view", "--json", "nameWithOwner,parent"], cwd, signal)
  return result.code === 0 ? parseRepo(result.output) : null
}

async function lookupByHead(gh: string, cwd: string, branch: string, head: string, repo: string, signal: AbortSignal) {
  const result = await runText(
    [
      gh,
      "pr",
      "list",
      "-R",
      repo,
      "--state",
      "open",
      "--head",
      branch,
      "--limit",
      "10",
      "--json",
      "number,title,headRefOid",
    ],
    cwd,
    signal,
  )
  return result.code === 0 ? selectPr(result.output, head) : null
}

async function lookupBySha(gh: string, cwd: string, head: string, repo: string | undefined, signal: AbortSignal) {
  const result = await runText(
    [
      gh,
      "pr",
      "list",
      ...(repo ? ["-R", repo] : []),
      "--state",
      "open",
      "--search",
      `${head} is:pr`,
      "--limit",
      "5",
      "--json",
      "number,title,headRefOid",
    ],
    cwd,
    signal,
  )
  return result.code === 0 ? selectPr(result.output, head) : null
}

// The tracking ref wins because `gh pr checkout` and fork checkouts both point
// HEAD's upstream at the PR; the SHA fallback guards same-repo branches without
// an upstream and fork branches whose parent repo differs.
export async function lookupPr(cwd: string, branch: string, signal: AbortSignal): Promise<Pr | null> {
  const gh = probeGh()
  if (!gh) return null
  const view = await lookupView(gh, cwd, branch, signal)
  if (view) return view
  const head = await lookupHead(cwd, signal)
  if (!head) return null
  const local = await lookupBySha(gh, cwd, head, undefined, signal)
  if (local) return local
  const parent = await lookupParent(gh, cwd, signal)
  if (!parent) return null
  const forked = await lookupByHead(gh, cwd, branch, head, parent, signal)
  if (forked) return forked
  return lookupBySha(gh, cwd, head, parent, signal)
}

/** Render the pull request for the viewed session's repository branch. */
export function PrSidebar(props: {
  readonly context: Plugin.Context
  readonly sessionID: string
  readonly signal?: AbortSignal
}) {
  const theme = props.context.theme
  const location = createMemo(() => props.context.data.session.get(props.sessionID)?.location ?? props.context.location)
  const branch = createMemo(() => {
    const ref = location()
    return ref ? props.context.data.location.vcs.info(ref)?.branch.current : undefined
  })
  const [pr, setPr] = createSignal<Pr>()

  createEffect(
    on(
      () => {
        const ref = location()
        return ref ? `${ref.directory}\u0000${ref.workspaceID ?? ""}` : undefined
      },
      () => {
        const ref = location()
        if (ref) void props.context.data.location.vcs.sync(ref).catch(() => undefined)
      },
    ),
  )

  // A branch change supersedes the previous lookup: its processes are aborted
  // and its late response is dropped, so only the current branch can render.
  createEffect(
    on(
      () => {
        const ref = location()
        const current = ref ? props.context.data.location.vcs.info(ref)?.branch.current : undefined
        return ref && current ? `${ref.directory}\u0000${ref.workspaceID ?? ""}\u0000${current}` : undefined
      },
      (key) => {
        setPr(undefined)
        if (!key) return
        const ref = location()
        const current = branch()
        if (!ref || !current) return
        const controller = new AbortController()
        const signal = props.signal ? AbortSignal.any([controller.signal, props.signal]) : controller.signal
        const deadline = setTimeout(() => controller.abort(), lookupDeadline)
        onCleanup(() => {
          clearTimeout(deadline)
          controller.abort()
        })
        void lookupPr(ref.directory, current, signal).then(
          (found) => {
            if (signal.aborted) return
            setPr(found ?? undefined)
          },
          () => undefined,
        )
      },
    ),
  )

  // The slot root must stay mounted; only the PR line is conditional.
  return (
    <box>
      <Show when={pr()}>
        <text fg={theme.text.subdued}>
          PR #{pr()!.number} - {pr()!.title}
        </text>
      </Show>
    </box>
  )
}

/** Append the pull request line to the host's existing sidebar content. */
export function installPrSidebar(ctx: Plugin.Context, options: { signal?: AbortSignal } = {}) {
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props) => <PrSidebar context={ctx} sessionID={props.sessionID} signal={options.signal} />,
  })
}
