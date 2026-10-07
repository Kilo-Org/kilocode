// Build the Slack message for stale-bot-pr-notify.yml.
//
// Security bots can open several PRs for the same fix (for example four PRs
// that all upgrade `simple-git`). Listing each one every day is noise, so PRs
// that touch the same package collapse into one line. Groups are found across
// ALL open bot PRs, not only the flagged ones, so a flagged PR still reports
// its unflagged duplicates.

export type Pr = {
  number: number
  url: string
  title: string
  author: { login: string }
}

export type Flagged = Pr & {
  age_days: number
  reason: string
}

// Package name from titles like "fix: upgrade simple-git to 4.0.2 for CVE-1"
// or "chore(deps): bump katex from 0.16.27 to 0.18.2". Grouped Dependabot
// titles ("bump the x-minor-patch group") have no package and return nothing.
export function pkg(title: string) {
  const match = title.match(/\b(?:upgrade|bump|update)\s+(?!the\b)(@?[a-z0-9][a-z0-9._/-]*)\s+(?:to|from)\s+v?\d/i)
  return match?.[1].toLowerCase()
}

export function groups(bots: Pr[]) {
  const map = new Map<string, Pr[]>()
  for (const pr of bots) {
    const key = pkg(pr.title)
    if (!key) continue
    map.set(key, [...(map.get(key) ?? []), pr])
  }
  return [...map].filter(([, list]) => list.length > 1)
}

export function text(flagged: Flagged[], bots: Pr[]) {
  if (flagged.length === 0) return ""
  const dups = groups(bots)
  const keys = new Set(dups.map(([key]) => key))
  const single = flagged.filter((pr) => {
    const key = pkg(pr.title)
    return !key || !keys.has(key)
  })
  const hit = new Set(flagged.map((pr) => pkg(pr.title)))
  const many = dups.filter(([key]) => hit.has(key))

  const one = (pr: Flagged) =>
    `- <${pr.url}|#${pr.number} ${pr.title}> (${pr.author.login}, ${pr.age_days}d old, ${pr.reason})`
  const dup = ([key, list]: (typeof many)[number]) =>
    `- ${list.length} open bot PRs touch \`${key}\`, likely duplicates: ${list.map((pr) => `<${pr.url}|#${pr.number}>`).join(", ")}. Keep one and close the rest.`

  return ["*Bot PRs needing attention:*", ...single.map(one), ...many.map(dup)].join("\n")
}

async function run() {
  const bots: Pr[] = await Bun.file(process.argv[2]).json()
  const flagged: Flagged[] = await Bun.file(process.argv[3]).json()
  console.log(JSON.stringify({ text: text(flagged, bots) }))
}

if (import.meta.main) await run()
