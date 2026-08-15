// Detection of the pull request (PR) linked to the current worktree, plus the
// manual override stored in session storage. The detection runs `gh pr view`
// and caches like `getGitUrl` (in-flight + TTL); the override is the same
// Storage shape used for `session_share`.
import { Instance } from "@/kilocode/instance"
import { Storage } from "@/storage/storage"
import { Process } from "@/util/process"
import { withInFlightCache } from "@/kilo-sessions/inflight-cache"

export type PrLink = {
  platform: string
  prUrl: string
  prNumber: number
}

export type PrLinkOverride = PrLink | { cleared: true }

const ttlMs = 10_000
const prLinkKeyPrefix = "kilo-sessions:pr-link:"

function platformFromHost(host: string): string {
  if (host === "github.com") return "github"
  const label = host.replace(/^www\./, "").split(".")[0]
  return label || host
}

function extractPrNumber(pathname: string): number | undefined {
  // GitHub: /owner/repo/pull/N
  let match = pathname.match(/^\/[^/]+\/[^/]+\/pull\/(\d+)(?:\/.*)?$/)
  if (match) return Number(match[1])

  // GitLab: /owner/repo/merge_requests/N and /owner/repo/-/merge_requests/N
  match = pathname.match(/\/merge_requests\/(\d+)\/?$/)
  if (match) return Number(match[1])

  // Generic: /pull/N and /pull-requests/N
  match = pathname.match(/\/(?:pull|pull-requests)\/(\d+)\/?$/)
  if (match) return Number(match[1])

  return undefined
}

export function parsePrUrl(url: string): PrLink | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined

  const number = extractPrNumber(parsed.pathname)
  if (number === undefined || number <= 0) return undefined

  parsed.hash = ""
  parsed.search = ""
  parsed.username = ""
  parsed.password = ""

  return {
    platform: platformFromHost(parsed.hostname),
    prUrl: parsed.toString(),
    prNumber: number,
  }
}

export async function detectPrLink(): Promise<PrLink | undefined> {
  return withInFlightCache(prLinkKeyPrefix + Instance.worktree, ttlMs, async () => {
    const result = await Process.text(["gh", "pr", "view", "--json", "url,number"], {
      nothrow: true,
      cwd: Instance.worktree,
    }).catch(() => undefined)
    if (!result || result.code !== 0) return undefined

    const raw = result.text.trim()
    if (!raw) return undefined

    let parsed: { url?: unknown; number?: unknown }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }

    if (typeof parsed.url !== "string" || parsed.url === "") return undefined
    if (typeof parsed.number !== "number" || !Number.isInteger(parsed.number) || parsed.number <= 0) return undefined

    let host: string
    try {
      host = new URL(parsed.url).hostname
    } catch {
      return undefined
    }

    return {
      platform: platformFromHost(host),
      prUrl: parsed.url,
      prNumber: parsed.number,
    }
  })
}

function overrideKey(worktree: string) {
  return ["session_pr_link", worktree]
}

export async function writePrLinkOverride(worktree: string, value: PrLinkOverride) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Storage.Service.use((svc) => svc.write(overrideKey(worktree), value)))
}

export async function readPrLinkOverride(worktree: string): Promise<PrLinkOverride | undefined> {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Storage.Service.use((svc) => svc.read<PrLinkOverride>(overrideKey(worktree)))).catch(
    () => undefined,
  )
}
