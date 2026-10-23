// Kilo TUI sidebar PR panel, ported from v1 `packages/opencode/src/kilocode/plugins/sidebar-pr.tsx`:
// shows "PR #<n> - <title>" for the current branch through the `gh` CLI, ordered first in the sidebar.
import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createResource, Show } from "solid-js"

const GH_PROBE_TTL = 300_000
const DEADLINE = 20_000
const COMMAND_TIMEOUT = 1_000

export type Pr = { readonly number: number; readonly title: string }
export type RunResult = { readonly code: number; readonly text: string }
export type Run = (cmd: string[], cwd: string, signal: AbortSignal) => Promise<RunResult>

type Item = Partial<Pr> & { readonly headRefOid?: string }
type Repo = {
  readonly nameWithOwner?: unknown
  readonly parent?: {
    readonly nameWithOwner?: unknown
    readonly name?: unknown
    readonly owner?: { readonly login?: unknown }
  } | null
}
type Exec = (cmd: string[]) => Promise<RunResult>

let ghPath: string | null | undefined
let ghProbeTime = 0

export async function lookup(cwd: string, branch: string, run: Run): Promise<Pr | null> {
  const ctrl = new AbortController()
  const deadline = setTimeout(() => ctrl.abort(), DEADLINE)
  const exec: Exec = (cmd) => run(cmd, cwd, ctrl.signal)
  try {
    // Try the tracking ref first (works when the PR was checked out through `gh pr checkout` or when the
    // branch's upstream is a fork). Fall back to an explicit branch lookup for same-repo branches.
    const view = (b?: string) => ["gh", "pr", "view", ...(b ? [b] : []), "--json", "number,title"]
    for (const cmd of [view(), view(branch)]) {
      const res = await exec(cmd)
      if (res.code !== 0) continue
      const text = res.text.trim()
      if (!text) continue
      const data = parse<Partial<Pr>>(text)
      if (!data || typeof data.number !== "number" || typeof data.title !== "string") continue
      return { number: data.number, title: data.title }
    }

    const head = await headOf(exec)
    if (!head) return null

    const local = await bySha(exec, head, undefined)
    if (local) return local

    const fork = await forkParent(exec)
    if (!fork) return null

    return (await byHead(exec, branch, head, fork)) ?? (await bySha(exec, head, fork))
  } finally {
    clearTimeout(deadline)
    ctrl.abort()
  }
}

export function select(text: string, head: string): Pr | null {
  const items = parse<Item[]>(text)
  if (!Array.isArray(items)) return null
  // Only accept a PR whose HEAD matches ours exactly, to avoid returning a random PR that merely
  // references the SHA in a commit message.
  for (const item of items) {
    if (item.headRefOid !== head) continue
    if (typeof item.number !== "number") continue
    if (typeof item.title !== "string") continue
    return { number: item.number, title: item.title }
  }
  return null
}

export function parent(text: string): string | null {
  const data = parse<Repo>(text)
  if (!data || typeof data.nameWithOwner !== "string") return null
  if (!data.parent) return null
  const name =
    typeof data.parent.nameWithOwner === "string"
      ? data.parent.nameWithOwner
      : typeof data.parent.owner?.login === "string" && typeof data.parent.name === "string"
        ? `${data.parent.owner.login}/${data.parent.name}`
        : null
  if (!name || name === data.nameWithOwner) return null
  return name
}

function parse<Value>(text: string): Value | null {
  try {
    return JSON.parse(text) as Value
  } catch {
    return null
  }
}

async function headOf(exec: Exec) {
  const res = await exec(["git", "rev-parse", "HEAD"])
  if (res.code !== 0) return null
  const head = res.text.trim()
  return head ? head : null
}

async function forkParent(exec: Exec) {
  const res = await exec(["gh", "repo", "view", "--json", "nameWithOwner,parent"])
  if (res.code !== 0) return null
  const text = res.text.trim()
  if (!text) return null
  return parent(text)
}

async function byHead(exec: Exec, branch: string, head: string, repo: string) {
  const res = await exec([
    "gh",
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
  ])
  if (res.code !== 0) return null
  const text = res.text.trim()
  if (!text) return null
  return select(text, head)
}

async function bySha(exec: Exec, head: string, repo: string | undefined) {
  const res = await exec([
    "gh",
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
  ])
  if (res.code !== 0) return null
  const text = res.text.trim()
  if (!text) return null
  return select(text, head)
}

function probeGh(): boolean {
  const now = Date.now()
  if (ghPath !== undefined && now - ghProbeTime < GH_PROBE_TTL) return ghPath !== null
  ghPath = Bun.which("gh") ?? null
  ghProbeTime = now
  return ghPath !== null
}

const systemRun: Run = async (cmd, cwd, signal) => {
  if (cmd[0] === "gh" && !probeGh()) return { code: 1, text: "" }
  return spawnText(cmd, cwd, signal)
}

async function spawnText(cmd: string[], cwd: string, signal: AbortSignal): Promise<RunResult> {
  const ctrl = new AbortController()
  const stop = () => ctrl.abort()
  const timer = setTimeout(stop, COMMAND_TIMEOUT)
  signal.addEventListener("abort", stop, { once: true })
  if (signal.aborted) stop()
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore", signal: ctrl.signal })
    const text = await new Response(proc.stdout).text()
    const code = await proc.exited
    return { code, text }
  } catch {
    return { code: 1, text: "" }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", stop)
  }
}

function View(props: { context: Plugin.Context; sessionID: string }) {
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const location = createMemo(() => session()?.location ?? props.context.location)
  const directory = createMemo(() => location()?.directory)
  const branch = createMemo(() => {
    const ref = location()
    if (!ref) return undefined
    return props.context.data.location.vcs.info(ref)?.branch.current
  })

  // Primitive string key: createResource compares with === for equality, so the same inputs produce a
  // stable key and the fetcher is not retriggered on every render.
  const key = createMemo(() => {
    const dir = directory()
    const name = branch()
    if (!dir || !name) return false as const
    return `${dir}\0${name}`
  })

  const [pr] = createResource(key, async (k) => {
    if (!k) return null
    const parts = k.split("\0")
    if (parts.length < 2) return null
    return lookup(parts[0], parts[1], systemRun).catch(() => null)
  })

  return (
    <Show when={pr()}>
      {(value) => (
        <text fg={props.context.theme.text.muted}>
          PR #{value().number} - {value().title}
        </text>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "kilocode.sidebar.pr",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      order: 50,
      render: (props) => <View context={context} sessionID={props.sessionID} />,
    })
  },
})
