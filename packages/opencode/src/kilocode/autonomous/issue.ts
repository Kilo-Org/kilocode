import { Effect } from "effect"
import { AutonomousShell } from "./shell"

/** GitHub issue references as goal objectives: `#123`, `owner/repo#123`, or an issue URL. */
export namespace AutonomousIssue {
  export type Ref = { ref: string; number: number; repo?: string }
  export type Issue = { title: string; body: string; url: string }

  const url = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/i
  const short = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/

  export function parse(text: string): Ref | undefined {
    const value = text.trim()
    const u = url.exec(value)
    if (u) return { ref: value, number: Number(u[2]), repo: u[1] }
    const s = short.exec(value)
    if (s) return { ref: value, number: Number(s[2]), ...(s[1] ? { repo: s[1] } : {}) }
    return undefined
  }

  export function objective(issue: Issue) {
    const body = issue.body.trim()
    return `${issue.title.trim()}${body ? `\n\n${body}` : ""}\n\nSource: ${issue.url}`.slice(0, 10_000)
  }

  /** Fetch through the gh CLI so existing GitHub auth is reused. */
  export const fetch = (ref: Ref, dir: string) =>
    Effect.gen(function* () {
      if (!Bun.which("gh")) return yield* Effect.fail(new Error("Resolving a GitHub issue needs the gh CLI installed and logged in."))
      const args = ["issue", "view", String(ref.number), "--json", "title,body,url", ...(ref.repo ? ["--repo", ref.repo] : [])]
      const result = yield* AutonomousShell.exec(["gh", ...args], { cwd: dir, timeout: 30_000 })
      if (result.code !== 0) return yield* Effect.fail(new Error(`gh issue view failed: ${result.stderr.trim() || result.stdout.trim()}`))
      const parsed = yield* Effect.try({ try: () => JSON.parse(result.stdout) as Partial<Issue>, catch: () => new Error("gh returned invalid JSON") })
      if (typeof parsed.title !== "string" || typeof parsed.url !== "string") return yield* Effect.fail(new Error("gh returned an unexpected issue shape"))
      return { title: parsed.title, body: typeof parsed.body === "string" ? parsed.body : "", url: parsed.url } satisfies Issue
    })

  /** Turn `text` into an objective, resolving an issue reference when present. */
  export const resolve = (text: string, dir: string, load: (ref: Ref, dir: string) => Effect.Effect<Issue, Error> = fetch) =>
    Effect.gen(function* () {
      const ref = parse(text)
      if (!ref) return { objective: text, issue: undefined }
      const issue = yield* load(ref, dir)
      return { objective: objective(issue), issue }
    })
}
