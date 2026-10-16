// Triage automation for community (non-maintainer) pull requests and issues.
//
//   label  Runs on PR/issue events (community-label.yml). Adds `community`,
//          `needs-triage` and `area:*` labels.
//   sweep  Runs twice a week (community-sweep.yml). Derives each community PR's
//          state, syncs status labels, closes stale ones and writes the digest.
//
// Flow and rules: docs/community-triage.md

import { appendFileSync } from "node:fs"

export const DAY = 24 * 60 * 60 * 1000
export const WAIT_DAYS = 14
const LIMIT = 15

export const label = {
  community: "community",
  triage: "needs-triage",
  review: "needs-review",
  awaiting: "awaiting-contributor",
  ci: "ci-failing",
  high: "high-value",
  low: "low-value",
  adopt: "needs-reimplementation",
  keep: "keep-open",
  first: "first-time-contributor",
  quick: "quick-win",
}

// Labels the sweep owns. It adds and removes these on its own.
const managed = [label.triage, label.review, label.awaiting, label.ci]

// Labels that only make sense on a community PR. A maintainer PR must not keep them.
export const cleanup = (current: string[]) =>
  [label.community, label.adopt, label.first, label.quick, ...managed].filter((name) => current.includes(name))

// Hand-set priority labels. One list feeds both label creation and the triage rule.
const priorities = [
  { name: "priority:p0", color: "b60205", description: "Critical. Set by hand." },
  { name: "priority:p1", color: "d93f0b", description: "High: important fixes, regressions. Set by hand." },
  { name: "priority:p2", color: "fbca04", description: "Medium: normal fixes and valuable features. Set by hand." },
  { name: "priority:p3", color: "c5def5", description: "Low: docs, polish, speculative features. Set by hand." },
]

const labels = [
  { name: label.community, color: "0e8a16", description: "Opened by someone outside the Kilo team" },
  { name: label.triage, color: "fbca04", description: "Community PR no maintainer has looked at yet" },
  { name: label.review, color: "1d76db", description: "Community PR waiting for a maintainer" },
  { name: label.awaiting, color: "d4c5f9", description: "Waiting for the contributor to reply" },
  { name: label.ci, color: "b60205", description: "Community PR with failing checks" },
  { name: label.high, color: "5319e7", description: "Maintainers want this change. Set by hand." },
  { name: label.low, color: "cfd3d7", description: "Triaged and not a priority. Set by hand." },
  {
    name: label.adopt,
    color: "e99695",
    description: "High-value PR with no contributor reply. The team takes it over.",
  },
  { name: label.keep, color: "bfdadc", description: "Never auto-close this PR. Set by hand." },
  { name: label.first, color: "fef2c0", description: "First contribution to this repo. Say hello!" },
  { name: label.quick, color: "bfd4f2", description: "Small, low-risk change. Quick to review." },
  ...priorities,
  { name: "area:vscode", color: "ededed", description: "VS Code extension" },
  { name: "area:cli", color: "ededed", description: "CLI, TUI and core engine" },
  { name: "area:agent-manager", color: "ededed", description: "Agent Manager" },
  { name: "area:jetbrains", color: "ededed", description: "JetBrains plugin" },
  { name: "area:desktop", color: "ededed", description: "Desktop and web app" },
  { name: "area:docs", color: "ededed", description: "Documentation" },
  { name: "area:gateway", color: "ededed", description: "Kilo Gateway and auth" },
  { name: "area:sdk", color: "ededed", description: "SDK" },
  { name: "area:ui", color: "ededed", description: "Shared UI components" },
  { name: "area:i18n", color: "ededed", description: "Translations" },
]

// Title scope, as in `fix(vscode): ...`
const scopes: Record<string, string> = {
  vscode: "area:vscode",
  cli: "area:cli",
  opencode: "area:cli",
  tui: "area:cli",
  core: "area:cli",
  "agent-manager": "area:agent-manager",
  jetbrains: "area:jetbrains",
  desktop: "area:desktop",
  app: "area:desktop",
  docs: "area:docs",
  "kilo-docs": "area:docs",
  gateway: "area:gateway",
  sdk: "area:sdk",
  ui: "area:ui",
  i18n: "area:i18n",
}

// Changed file path prefix. The first matching rule for a file wins.
const paths: [string, string][] = [
  ["packages/kilo-vscode/src/agent-manager/", "area:agent-manager"],
  ["packages/kilo-vscode/webview-ui/agent-manager/", "area:agent-manager"],
  ["packages/kilo-vscode/", "area:vscode"],
  ["packages/opencode/", "area:cli"],
  ["packages/core/", "area:cli"],
  ["packages/server/", "area:cli"],
  ["packages/tui/", "area:cli"],
  ["packages/kilo-jetbrains/", "area:jetbrains"],
  ["packages/kilo-docs/", "area:docs"],
  ["packages/kilo-gateway/", "area:gateway"],
  ["packages/sdk/", "area:sdk"],
  ["packages/kilo-ui/", "area:ui"],
  ["packages/kilo-i18n/", "area:i18n"],
  ["packages/kilo-web-ui/", "area:desktop"],
]

// Options of the "Component" dropdown in the issue templates.
const components: Record<string, string> = {
  "vs code extension": "area:vscode",
  "cli / tui": "area:cli",
  "agent manager": "area:agent-manager",
  "jetbrains plugin": "area:jetbrains",
  "desktop or web app": "area:desktop",
  documentation: "area:docs",
  "kilo gateway or account": "area:gateway",
  sdk: "area:sdk",
}

// Plain objects inherit keys like "constructor". Only own keys are labels.
const own = (map: Record<string, string>, key: string) => (Object.hasOwn(map, key) ? map[key] : undefined)

// Product names in a title. Used when there is no scope or dropdown answer,
// for example issues that skip the form: "Deleting a chat has no undo (Kilo Desktop)".
const names: [RegExp, string][] = [
  [/\bkilo desktop\b/i, "area:desktop"],
  [/\bagent manager\b/i, "area:agent-manager"],
  [/\bjetbrains\b/i, "area:jetbrains"],
]

export const mention = (title: string) => names.filter(([pattern]) => pattern.test(title)).map(([, tag]) => tag)

export function areas(title: string, files: string[]) {
  const set = new Set<string>()
  const scope = title.match(/^\w+\(([^)]+)\)!?:/)?.[1]
  const hit = scope ? own(scopes, scope.toLowerCase()) : undefined
  if (hit) set.add(hit)
  for (const tag of mention(title)) set.add(tag)
  for (const file of files) {
    const rule = paths.find(([prefix]) => file.startsWith(prefix))
    if (rule) set.add(rule[1])
  }
  return [...set].sort()
}

export function component(body: string) {
  // Issue forms render the answer as "### Component". Text the reporter typed
  // can contain the same heading, so take the first one with a known answer.
  for (const hit of body.matchAll(/^###\s+Component\s*\n+(.+)$/gim)) {
    const tag = own(components, hit[1].trim().toLowerCase())
    if (tag) return tag
  }
}

// Clocks differ a little between a contributor and GitHub. Allow a small skew.
const SKEW = 5 * 60 * 1000

// GitHub sets these when the author has no merged contribution here yet.
const FIRST = new Set(["FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER"])
export const newcomer = (assoc: string | undefined) => FIRST.has(assoc ?? "")

// Quick wins are small, low-risk changes that are fast to review.
export const EASY_LINES = 150
export const SMALL_LINES = 50
const SMALL_FILES = 3
// Never a quick win, even when small: CI, dependencies, scripts and account code.
const risky = [".github/", ".kilo/", "script/", "patches/", "packages/kilo-gateway/"]
const riskyFiles = ["package.json", "bun.lock"]
// Markdown that steers agents or release notes is not documentation.
const meta = (file: string) => file.startsWith(".kilo/") || file.startsWith(".changeset/")
const docs = (file: string) =>
  !meta(file) && (file.startsWith("packages/kilo-docs/") || file.startsWith("docs/") || /\.mdx?$/.test(file))
const tests = (file: string) => /(^|\/)(tests?|__tests__)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)

export type Quick = "docs" | "tests" | "small"

export function easy(lines: number, files: string[]): Quick | undefined {
  if (files.length === 0) return undefined
  if (files.some((file) => risky.some((dir) => file.startsWith(dir)) || riskyFiles.some((x) => file.endsWith(x))))
    return undefined
  if (lines <= EASY_LINES && files.every(docs)) return "docs"
  if (lines <= EASY_LINES && files.every(tests)) return "tests"
  if (lines <= SMALL_LINES && files.length <= SMALL_FILES) return "small"
  return undefined
}

export function pushedAt(date: string, now: number) {
  const at = Date.parse(date)
  return at > now + SKEW ? undefined : at
}

export type Event = { who: "author" | "maintainer"; at: number; approve?: boolean }

export type State =
  | { state: "triage" }
  | { state: "review" }
  | { state: "approved" }
  | { state: "awaiting"; since: number; days: number }

// A hand-set label means a maintainer already looked at the PR.
const triaged = (tags: string[]) =>
  tags.includes(label.high) || tags.includes(label.low) || priorities.some((item) => tags.includes(item.name))

// Whose turn it is. The latest maintainer reaction decides, unless the author
// answered (comment, review reply or new commit) after it.
export function classify(events: Event[], tags: string[], now: number): State {
  const last = (who: Event["who"]) =>
    events
      .filter((e) => e.who === who)
      .sort((a, b) => b.at - a.at)
      .at(0)
  const maintainer = last("maintainer")
  const author = last("author")
  if (!maintainer) return { state: triaged(tags) ? "review" : "triage" }
  if (author && author.at > maintainer.at) return { state: "review" }
  if (maintainer.approve) return { state: "approved" }
  return { state: "awaiting", since: maintainer.at, days: Math.floor((now - maintainer.at) / DAY) }
}

export function decide(current: string[], state: State, failing: boolean) {
  const want = new Set<string>()
  if (state.state === "triage") want.add(label.triage)
  if (state.state === "review") want.add(label.review)
  if (state.state === "awaiting") want.add(label.awaiting)
  if (failing) want.add(label.ci)
  return {
    add: [...want].filter((name) => !current.includes(name)),
    remove: managed.filter((name) => !want.has(name) && current.includes(name)),
  }
}

export type Row = {
  number: number
  title: string
  url: string
  author: string
  created: number
  state: State
  failing: boolean
  adopt: boolean
  closed: boolean
  first: boolean
  quick?: Quick
}

export type Digest = { title: string; counts: string; blocks: string[] }

// Split into a title, a one-line count summary and one block per section, so
// Slack can show the summary and put the lists in a thread.
export function parts(rows: Row[], mode: "md" | "slack", repo: string, now: number): Digest {
  const link = (row: Row) => {
    const text = `#${row.number} ${row.title.replace(/[<>|]/g, "")}`
    return mode === "md" ? `[${text}](${row.url})` : `<${row.url}|${text}>`
  }
  const age = (row: Row) => Math.floor((now - row.created) / DAY)
  const bold = (text: string) => (mode === "md" ? `**${text}**` : `*${text}*`)
  const open = rows.filter((row) => !row.closed)
  const found: { short: string; count: number; text: string }[] = []
  const section = (name: string, short: string, list: Row[], note: (row: Row) => string) => {
    if (list.length === 0) return
    const shown = list.slice(0, LIMIT).map((row) => `- ${link(row)} (@${row.author}, ${note(row)})`)
    const more = list.length > LIMIT ? [`- ...and ${list.length - LIMIT} more`] : []
    found.push({ short, count: list.length, text: [bold(`${name} (${list.length})`), ...shown, ...more].join("\n") })
  }
  const awaiting = (row: Row) => (row.state.state === "awaiting" ? row.state : undefined)
  const state = (name: State["state"]) => open.filter((row) => row.state.state === name)
  const oldest = (a: Row, b: Row) => a.created - b.created
  const ci = (row: Row) => `${row.first ? ", first-time contributor" : ""}${row.failing ? ", CI failing" : ""}`

  section(
    "Adopt: high-value, no reply in 14 days",
    "Adopt",
    open.filter((row) => row.adopt),
    (row) => `${awaiting(row)?.days}d silent`,
  )
  const kind = { docs: "docs only", tests: "tests only", small: "small change" }
  section(
    "Quick wins: small and low-risk",
    "Quick",
    open.filter((row) => row.quick && row.state.state !== "awaiting").sort(oldest),
    (row) => `${kind[row.quick!]}${ci(row)}`,
  )
  section("Needs triage", "Triage", state("triage").sort(oldest), (row) => `${age(row)}d old${ci(row)}`)
  section(
    "Contributor replied, needs review",
    "Review",
    state("review").sort(oldest),
    (row) => `${age(row)}d old${ci(row)}`,
  )
  section("Approved, ready to merge", "Approved", state("approved"), (row) => `${age(row)}d old${ci(row)}`)
  section(
    "Waiting for contributor",
    "Waiting",
    state("awaiting").sort((a, b) => (awaiting(b)?.days ?? 0) - (awaiting(a)?.days ?? 0)),
    (row) => `${awaiting(row)?.days}d of ${WAIT_DAYS}${ci(row)}`,
  )
  section(
    "Closed in this run",
    "Closed",
    rows.filter((row) => row.closed),
    () => `no reply in ${WAIT_DAYS} days`,
  )

  const firsts = open.filter((row) => row.first).length

  return {
    title: bold(`Community PR queue for ${repo}: ${open.length} open`),
    counts: [...found.map((item) => `${item.short}: ${item.count}`), ...(firsts ? [`First-time: ${firsts}`] : [])].join(
      " · ",
    ),
    blocks: found.map((item) => item.text),
  }
}

export function digest(rows: Row[], mode: "md" | "slack", repo: string, now: number) {
  const out = parts(rows, mode, repo, now)
  return [out.title, ...out.blocks.flatMap((block) => ["", block])].join("\n")
}

// Slack rejects text over 40,000 characters, and long sections read badly.
export function clip(text: string, max = 3500) {
  if (text.length <= max) return text
  const cut = text.slice(0, max).lastIndexOf("\n")
  return text.slice(0, cut > 0 ? cut : max) + "\n- ...list shortened"
}

type SlackReply = { ok: boolean; ts?: string; error?: string; needed?: string; provided?: string }

// Slack names the missing scope in `needed` and `provided`. Show them.
export function failure(json: Pick<SlackReply, "error" | "needed" | "provided">) {
  const scope = json.needed ? ` (needed: ${json.needed}, provided: ${json.provided ?? "none"})` : ""
  return `Slack chat.postMessage failed: ${json.error ?? "unknown error"}${scope}`
}

const warn = (title: string, err: unknown) =>
  console.log(`::warning title=${title}::${err instanceof Error ? err.message : String(err)}`)

async function slack(out: Digest, url: string) {
  const token = process.env.SLACK_TOKEN!
  const channel = process.env.SLACK_CHANNEL!
  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, unfurl_links: false, ...body }),
    })
    const json = (await res.json()) as SlackReply
    if (!json.ok) throw new Error(failure(json))
    return json.ts!
  }
  const ts = await post({ text: [out.title, out.counts, url ? `<${url}|Full run>` : ""].filter(Boolean).join("\n") })
  // The summary is out. A failed section must not trigger the webhook
  // fallback, which would post the whole queue a second time.
  for (const block of out.blocks) {
    try {
      await post({ thread_ts: ts, text: clip(block) })
    } catch (err) {
      warn("Slack thread post failed", err)
    }
  }
}

// ---- GitHub I/O ----

const token = process.env.GH_TOKEN
const repo = process.env.REPO ?? "Kilo-Org/kilocode"
const [owner, name] = repo.split("/")
const bots = (login: string) => login.endsWith("[bot]")
const trusted = new Set(["OWNER", "MEMBER", "COLLABORATOR"])
const extra = new Set(
  (process.env.MAINTAINERS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
)
const cache = new Map<string, boolean>()

async function api(path: string, init?: RequestInit & { token?: string; ok?: number[] }) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${init?.token ?? token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
  })
  if (res.ok || init?.ok?.includes(res.status)) return res
  throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`)
}

// GITHUB_TOKEN cannot see private org members, so they show up as plain
// contributors. An optional MEMBER_TOKEN (read:org) or MAINTAINERS list fixes that.
async function maintainer(login: string, assoc: string) {
  if (trusted.has(assoc) || extra.has(login.toLowerCase())) return true
  const key = login.toLowerCase()
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const lookup = process.env.MEMBER_TOKEN
  const res = lookup ? await api(`/orgs/${owner}/members/${login}`, { token: lookup, ok: [302, 404] }) : undefined
  const found = res?.status === 204
  cache.set(key, found)
  return found
}

async function ensure() {
  for (const item of labels)
    await api(`/repos/${repo}/labels`, { method: "POST", body: JSON.stringify(item), ok: [422] })
}

const add = (num: number, list: string[]) =>
  list.length === 0
    ? undefined
    : api(`/repos/${repo}/issues/${num}/labels`, { method: "POST", body: JSON.stringify({ labels: list }) })
const drop = (num: number, list: string[]) =>
  Promise.all(
    list.map((item) =>
      api(`/repos/${repo}/issues/${num}/labels/${encodeURIComponent(item)}`, { method: "DELETE", ok: [404] }),
    ),
  )
const comment = (num: number, body: string) =>
  api(`/repos/${repo}/issues/${num}/comments`, { method: "POST", body: JSON.stringify({ body }) })

async function files(num: number) {
  const out: string[] = []
  for (let page = 1; ; page++) {
    const list: { filename: string }[] = await (
      await api(`/repos/${repo}/pulls/${num}/files?per_page=100&page=${page}`)
    ).json()
    out.push(...list.map((f) => f.filename))
    if (list.length < 100 || page >= 30) return out
  }
}

async function onevent() {
  const event = await Bun.file(process.env.GITHUB_EVENT_PATH!).json()
  const pr = event.pull_request
  const item = pr ?? event.issue
  const login: string = item.user.login
  if (item.user.type === "Bot" || bots(login)) return console.log(`skip bot ${login}`)

  // A reopened PR may already be triaged. The sweep decides its status.
  const fresh = event.action === "opened"
  const community = !(await maintainer(login, item.author_association))
  const tags = new Set<string>()
  if (community) tags.add(label.community)
  if (community && fresh) tags.add(label.triage)
  if (community && newcomer(item.author_association)) tags.add(label.first)
  if (pr) for (const tag of areas(pr.title, await files(pr.number))) tags.add(tag)
  if (!pr) {
    // The form answer wins. Without one, fall back to product names in the title.
    const tag = component(item.body ?? "")
    for (const name of tag ? [tag] : mention(item.title)) tags.add(name)
  }
  const have = new Set<string>(item.labels.map((l: { name: string }) => l.name))
  const next = [...tags].filter((tag) => !have.has(tag))
  console.log(`#${item.number} ${community ? "community" : "maintainer"}: adding [${next.join(", ")}]`)
  await ensure()
  await add(item.number, next)
}

type Actor = { login: string; __typename: string } | null
type Node = { createdAt: string; authorAssociation: string; author: Actor; state?: string }
type Pull = {
  number: number
  title: string
  url: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  createdAt: string
  authorAssociation: string
  author: Actor
  labels: { nodes: { name: string }[] }
  commits: { nodes: { commit: { committedDate: string; statusCheckRollup: { state: string } | null } }[] }
  timelineItems: { nodes: { createdAt: string; actor: { login: string } | null }[] }
  comments: { totalCount: number; nodes: Node[] }
  reviews: { totalCount: number; nodes: Node[] }
  reviewThreads: { totalCount: number; nodes: { comments: { nodes: Node[] } }[] }
}

type Reply = { user: { login: string } | null; created_at?: string; submitted_at?: string }

// The query reads only the latest comments, reviews and replies. Before a PR
// is closed or adopted, ask the API for everything since the maintainer's
// last reaction, so a reply outside that window cannot be missed.
async function replied(num: number, login: string, since: number) {
  const iso = new Date(since).toISOString()
  const get = async (path: string): Promise<Reply[]> => (await api(`/repos/${repo}/${path}`)).json()
  const mine = (list: Reply[]) =>
    list.some((x) => x.user?.login === login && Date.parse(x.created_at ?? x.submitted_at ?? "") > since)
  if (mine(await get(`issues/${num}/comments?since=${iso}&per_page=100`))) return true
  if (mine(await get(`pulls/${num}/comments?since=${iso}&per_page=100`))) return true
  for (let page = 1; page <= 5; page++) {
    const list = await get(`pulls/${num}/reviews?per_page=100&page=${page}`)
    if (mine(list)) return true
    if (list.length < 100) return false
  }
  return false
}

const query = `
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 25, states: OPEN, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft additions deletions changedFiles createdAt
        authorAssociation
        author { login __typename }
        labels(first: 30) { nodes { name } }
        timelineItems(last: 1, itemTypes: [REOPENED_EVENT]) { nodes { ... on ReopenedEvent { createdAt actor { login } } } }
        commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
        comments(last: 20) { totalCount nodes { createdAt authorAssociation author { login __typename } } }
        reviews(last: 20) { totalCount nodes { createdAt state authorAssociation author { login __typename } } }
        reviewThreads(last: 20) { totalCount nodes { comments(last: 5) { nodes { createdAt authorAssociation author { login __typename } } } } }
      }
    }
  }
}`

async function graphql(cursor: string | null) {
  const res = await api("/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables: { owner, repo: name, cursor } }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data.repository.pullRequests
}

// Small and green PRs only. Merge state costs one request, so it runs last.
async function quick(pr: Pull, ready: boolean) {
  const lines = pr.additions + pr.deletions
  if (!ready || lines > EASY_LINES || pr.changedFiles > 10) return undefined
  const kind = easy(lines, await files(pr.number))
  if (!kind) return undefined
  const detail: { mergeable: boolean | null } = await (await api(`/repos/${repo}/pulls/${pr.number}`)).json()
  return detail.mergeable === true ? kind : undefined
}

async function sweep() {
  const now = Date.now()
  const enabled = process.env.CLOSE_ENABLED === "true"
  const cap = Number(process.env.MAX_COMMENTS ?? 20)
  let spent = 0
  await ensure()

  const prs: Pull[] = []
  let cursor: string | null = null
  do {
    const page = await graphql(cursor)
    prs.push(...page.nodes)
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)
  console.log(`${prs.length} open PRs`)

  const rows: Row[] = []
  for (const pr of prs) {
    const login = pr.author?.login
    if (!login || pr.author?.__typename === "Bot" || bots(login)) continue
    const tags = pr.labels.nodes.map((l) => l.name)
    if (await maintainer(login, pr.authorAssociation)) {
      // Heals labels set before the maintainer list was known.
      const wrong = cleanup(tags)
      if (wrong.length > 0) console.log(`#${pr.number} maintainer PR, removing [${wrong}]`)
      await drop(pr.number, wrong)
      continue
    }
    if (pr.isDraft) continue
    const nodes: Node[] = [
      ...pr.comments.nodes,
      ...pr.reviews.nodes.filter((r: Node) => r.state !== "PENDING" && r.state !== "DISMISSED"),
      ...pr.reviewThreads.nodes.flatMap((t: { comments: { nodes: Node[] } }) => t.comments.nodes),
    ]
    const events: Event[] = []
    for (const node of nodes) {
      const who = node.author?.login
      if (!who || node.author?.__typename === "Bot" || bots(who)) continue
      const at = Date.parse(node.createdAt)
      if (who === login) events.push({ who: "author", at })
      else if (await maintainer(who, node.authorAssociation))
        events.push({ who: "maintainer", at, approve: node.state === "APPROVED" })
    }
    const commit = pr.commits.nodes.at(0)?.commit
    // Commit dates come from the commit author. A date in the future would sort
    // after every maintainer reaction, so it is ignored. A small clock skew is allowed.
    const pushed = commit ? pushedAt(commit.committedDate, now) : undefined
    if (pushed) events.push({ who: "author", at: pushed })
    // Reopening a closed PR is a reply too.
    const reopen = pr.timelineItems.nodes.at(0)
    if (reopen?.actor?.login === login) events.push({ who: "author", at: Date.parse(reopen.createdAt) })

    // The query reads only the latest events. If it missed some and found no
    // maintainer reaction, the reaction may be older than the window. Send the
    // PR to a human, do not call it untriaged.
    const cut =
      pr.comments.totalCount > pr.comments.nodes.length ||
      pr.reviews.totalCount > pr.reviews.nodes.length ||
      pr.reviewThreads.totalCount > pr.reviewThreads.nodes.length
    const first = classify(events, tags, now)
    const state: State =
      first.state === "triage" && cut
        ? { state: "review" }
        : first.state === "awaiting" && first.days >= WAIT_DAYS && (await replied(pr.number, login, first.since))
          ? { state: "review" }
          : first
    const failing = ["FAILURE", "ERROR"].includes(commit?.statusCheckRollup?.state ?? "")
    const plan = decide(tags, state, failing)
    const more = [...(tags.includes(label.community) ? [] : [label.community])]
    if (!tags.some((tag) => tag.startsWith("area:"))) more.push(...areas(pr.title, await files(pr.number)))
    // Product names in the title cost no request, so they are checked on every run.
    more.push(...mention(pr.title).filter((tag) => !tags.includes(tag) && !more.includes(tag)))
    const green = commit?.statusCheckRollup?.state === "SUCCESS"
    const kind = await quick(pr, green && ["triage", "review", "approved"].includes(state.state))
    const flags: [string, boolean][] = [
      [label.first, newcomer(pr.authorAssociation)],
      [label.quick, kind !== undefined],
    ]
    for (const [tag, on] of flags) {
      if (on && !tags.includes(tag)) more.push(tag)
      if (!on && tags.includes(tag)) plan.remove.push(tag)
    }
    const row: Row = {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: login,
      created: Date.parse(pr.createdAt),
      state,
      failing,
      adopt: false,
      closed: false,
      first: newcomer(pr.authorAssociation),
      quick: kind,
    }

    if (state.state === "awaiting" && state.days >= WAIT_DAYS) {
      if (tags.includes(label.high)) {
        row.adopt = true
        if (!tags.includes(label.adopt)) more.push(label.adopt)
      } else if (!tags.includes(label.keep)) {
        if (!enabled) console.log(`[dry-run] would close #${pr.number} (${state.days}d without reply)`)
        else if (spent < cap) {
          spent++
          await comment(
            pr.number,
            `Closing this pull request because a maintainer asked for changes on ${new Date(state.since).toISOString().slice(0, 10)} and we have not heard back in ${WAIT_DAYS} days. Feel free to reopen it when you have updates, or open a new one.`,
          )
          await api(`/repos/${repo}/pulls/${pr.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) })
          row.closed = true
          console.log(`closed #${pr.number}`)
        }
      }
    } else if (state.state === "awaiting" && plan.add.includes(label.awaiting) && enabled && spent < cap) {
      spent++
      const due = new Date(state.since + WAIT_DAYS * DAY).toISOString().slice(0, 10)
      await comment(
        pr.number,
        `Thanks for the contribution! A maintainer left feedback and is waiting for your reply. If we do not hear back by ${due}, this pull request will be closed. Push a fix or leave a comment to keep it open.`,
      )
    }

    if (state.state !== "awaiting" && tags.includes(label.adopt)) plan.remove.push(label.adopt)
    console.log(
      `#${pr.number} ${state.state}${failing ? " ci-failing" : ""} +[${[...plan.add, ...more]}] -[${plan.remove}]`,
    )
    await add(pr.number, [...plan.add, ...more])
    await drop(pr.number, row.closed ? [] : plan.remove)
    rows.push(row)
  }

  const out = process.env.GITHUB_STEP_SUMMARY
  if (out) await Bun.write(out, digest(rows, "md", repo, now) + "\n")
  const payload = process.env.SLACK_PAYLOAD
  if (payload) await Bun.write(payload, JSON.stringify({ text: digest(rows, "slack", repo, now) }))
  // With a bot token and channel, post the summary and thread the lists.
  if (process.env.SLACK_TOKEN && process.env.SLACK_CHANNEL) {
    const run = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : ""
    // Slack must not fail a sweep whose labels are already done. If not even
    // the summary was posted, warn and tell the workflow to use the webhook.
    try {
      await slack(parts(rows, "slack", repo, now), run)
    } catch (err) {
      warn("Slack post failed", err)
      const flag = process.env.GITHUB_OUTPUT
      if (flag) appendFileSync(flag, "slack_failed=true\n")
    }
  }
  console.log(digest(rows, "md", repo, now))
}

if (import.meta.main) {
  const cmd = process.argv[2]
  if (cmd === "label") await onevent()
  else if (cmd === "sweep") await sweep()
  else {
    console.error("usage: community-triage.ts <label|sweep>")
    process.exit(1)
  }
}
