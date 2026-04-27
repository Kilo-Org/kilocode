// kilocode_change - new file
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, createResource, Show } from "solid-js"
import { Process } from "@/util"

const id = "internal:kilo-sidebar-pr"
const GH_PROBE_TTL = 300_000

type Pr = { number: number; title: string }
type Item = Partial<Pr> & { headRefOid?: string }
type Repo = {
  nameWithOwner?: unknown
  parent?: { nameWithOwner?: unknown; name?: unknown; owner?: { login?: unknown } } | null
}

let ghPath: string | null | undefined
let ghProbeTime = 0

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(id)
      signal.removeEventListener("abort", stop)
    }

    const stop = () => {
      done()
      reject(signal.reason)
    }

    const id = setTimeout(() => {
      done()
      resolve()
    }, ms)

    signal.addEventListener("abort", stop, { once: true })
  })
}

async function lookup(cwd: string, branch: string): Promise<Pr | null> {
  const ctrl = new AbortController()
  const deadline = wait(20_000, ctrl.signal).then(() => ctrl.abort())

  try {
    if (!probeGh()) return null

    // Try the tracking ref first (works when PR was checked out via `gh pr checkout`
    // or when the branch's upstream is a fork). Fall back to an explicit branch
    // lookup (works for same-repo branches pushed to origin).
    const build = (b?: string) => {
      const a = ["gh", "pr", "view"]
      if (b) a.push(b)
      a.push("--json", "number,title")
      return a
    }
    for (const cmd of [build(), build(branch)]) {
      const res = await Process.text(cmd, {
        cwd,
        abort: ctrl.signal,
        nothrow: true,
        timeout: 1_000,
      })
      if (res.code !== 0) continue
      const text = res.text.trim()
      if (!text) continue
      const data = JSON.parse(text) as Partial<Pr>
      if (typeof data.number === "number" && typeof data.title === "string") {
        return { number: data.number, title: data.title }
      }
    }

    const head = await lookupHead(cwd, ctrl.signal)
    if (!head) return null

    const local = await lookupBySha(cwd, head, undefined, ctrl.signal)
    if (local) return local

    const parent = await lookupParent(cwd, ctrl.signal)
    if (!parent) return null

    const pr = await lookupByHead(cwd, branch, head, parent, ctrl.signal)
    if (pr) return pr

    return await lookupBySha(cwd, head, parent, ctrl.signal)
  } finally {
    ctrl.abort()
    await deadline.catch(() => undefined)
  }
}

async function lookupHead(cwd: string, signal: AbortSignal): Promise<string | null> {
  const res = await Process.text(["git", "rev-parse", "HEAD"], {
    cwd,
    abort: signal,
    nothrow: true,
    timeout: 1_000,
  })
  if (res.code !== 0) return null

  const head = res.text.trim()
  if (!head) return null

  return head
}

async function lookupParent(cwd: string, signal: AbortSignal): Promise<string | null> {
  const res = await Process.text(["gh", "repo", "view", "--json", "nameWithOwner,parent"], {
    cwd,
    abort: signal,
    nothrow: true,
    timeout: 1_000,
  })
  if (res.code !== 0) return null

  const text = res.text.trim()
  if (!text) return null

  try {
    const data = JSON.parse(text) as Repo
    if (typeof data.nameWithOwner !== "string") return null
    if (!data.parent) return null

    const parent =
      typeof data.parent.nameWithOwner === "string"
        ? data.parent.nameWithOwner
        : typeof data.parent.owner?.login === "string" && typeof data.parent.name === "string"
          ? `${data.parent.owner.login}/${data.parent.name}`
          : null
    if (!parent || parent === data.nameWithOwner) return null

    return parent
  } catch {
    return null
  }
}

async function lookupByHead(
  cwd: string,
  branch: string,
  head: string,
  repo: string,
  signal: AbortSignal,
): Promise<Pr | null> {
  const res = await Process.text(
    [
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
    ],
    {
      cwd,
      abort: signal,
      nothrow: true,
      timeout: 1_000,
    },
  )
  if (res.code !== 0) return null

  const text = res.text.trim()
  if (!text) return null

  return select(text, head)
}

async function lookupBySha(
  cwd: string,
  head: string,
  repo: string | undefined,
  signal: AbortSignal,
): Promise<Pr | null> {
  const cmd = [
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
  ]
  const res = await Process.text(cmd, {
    cwd,
    abort: signal,
    nothrow: true,
    timeout: 1_000,
  })
  if (res.code !== 0) return null

  const text = res.text.trim()
  if (!text) return null

  return select(text, head)
}

function select(text: string, head: string): Pr | null {
  try {
    const items = JSON.parse(text) as Item[]
    if (!Array.isArray(items) || items.length === 0) return null

    // Only accept a PR whose HEAD matches ours exactly — avoids returning a
    // random PR that merely references the SHA in a commit message.
    for (const item of items) {
      if (item.headRefOid !== head) continue
      if (typeof item.number !== "number") continue
      if (typeof item.title !== "string") continue
      return { number: item.number, title: item.title }
    }

    return null
  } catch {
    return null
  }
}

function probeGh(): string | null {
  const now = Date.now()
  if (ghPath !== undefined && now - ghProbeTime < GH_PROBE_TTL) return ghPath
  ghPath = Bun.which("gh") ?? null
  ghProbeTime = now
  return ghPath
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const branch = createMemo(() => props.api.state.vcs?.branch)
  const cwd = createMemo(() => props.api.state.path.directory)

  // Primitive string key: createResource wraps source in createMemo and
  // compares with === for equality, so the same inputs produce a stable key
  // and the fetcher is not retriggered on every render.
  const key = createMemo(() => {
    const b = branch()
    const d = cwd()
    if (!b || !d) return false as const
    return `${d}\0${b}`
  })

  const [pr] = createResource(key, async (k) => {
    if (!k) return null
    const [d, b] = k.split("\0")
    if (!d || !b) return null
    return lookup(d, b).catch(() => null)
  })

  // The wrapper <box> must be present unconditionally — the OpenTUI slot
  // registry relies on a stable root node per plugin. Gating the whole tree
  // on `<Show>` breaks the mount. Conditionally render only the inner text.
  return (
    <box>
      <Show when={pr()}>
        <text fg={theme().textMuted}>
          PR #{pr()!.number} - {pr()!.title}
        </text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, _props) {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }

export default plugin
