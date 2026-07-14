import path from "path"
import { ConfigReference } from "@opencode-ai/core/config/reference"
import { Global } from "@opencode-ai/core/global"
import { parseRepositoryReference, repositoryCachePath, type RemoteReference } from "@/util/repository"
import { Effect } from "effect"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { isInterrupted } from "@/kilocode/effect/cause"

export type Resolved =
  | {
      name: string
      kind: "local"
      path: string
    }
  | {
      name: string
      kind: "git"
      repository: string
      reference: RemoteReference
      path: string
      branch?: string
    }
  | {
      name: string
      kind: "invalid"
      repository?: string
      message: string
    }

type Normalized =
  | { kind: "local"; path: string }
  | { kind: "git"; repository: string; branch?: string }
  | { kind: "invalid"; message: string }

function normalize(name: string, entry: ConfigReference.Entry): Normalized {
  if (name.length === 0) return { kind: "invalid", message: "Reference alias must not be empty" }
  if (/[\/\s`,]/.test(name)) {
    return { kind: "invalid", message: "Reference alias must not contain /, whitespace, comma, or backtick" }
  }
  if (typeof entry === "string") {
    if (entry.startsWith(".") || entry.startsWith("/") || entry.startsWith("~")) {
      return { kind: "local", path: entry }
    }
    return { kind: "git", repository: entry }
  }
  if ("path" in entry) return { kind: "local", path: entry.path }
  return { kind: "git", repository: entry.repository, branch: entry.branch }
}

function local(input: { directory: string; worktree: string; value: string }) {
  if (input.value.startsWith("~/")) return path.join(Global.Path.home, input.value.slice(2))
  if (path.isAbsolute(input.value)) return input.value
  return path.resolve(input.worktree === "/" ? input.directory : input.worktree, input.value)
}

function resolve(name: string, entry: Normalized, directory: string, worktree: string): Resolved {
  if (entry.kind === "invalid") return { name, kind: "invalid", message: entry.message }
  if (entry.kind === "local") {
    return { name, kind: "local", path: local({ directory, worktree, value: entry.path }) }
  }
  const reference = parseRepositoryReference(entry.repository)
  if (!reference || reference.protocol === "file:") {
    return {
      name,
      kind: "invalid",
      repository: entry.repository,
      message: "Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand",
    }
  }
  return {
    name,
    kind: "git",
    repository: entry.repository,
    reference,
    path: repositoryCachePath(reference),
    branch: entry.branch,
  }
}

export function resolveAll(input: { references: ConfigReference.Info; directory: string; worktree: string }) {
  const seen = new Map<string, { name: string; branch?: string }>()
  return Object.entries(input.references).map(([name, entry]) => {
    const item = resolve(name, normalize(name, entry), input.directory, input.worktree)
    if (item.kind !== "git") return item

    const existing = seen.get(item.path)
    if (!existing) {
      seen.set(item.path, { name, branch: item.branch })
      return item
    }
    if (existing.branch === item.branch) return item

    return {
      name,
      kind: "invalid" as const,
      repository: item.repository,
      message: `Reference conflicts with @${existing.name}: both use ${item.path}, but @${existing.name} requests ${existing.branch ?? "default branch"} and @${name} requests ${item.branch ?? "default branch"}`,
    }
  })
}

export function ensure(cache: RepositoryCache.Interface, item: Extract<Resolved, { kind: "git" }>) {
  return cache.ensure({ reference: item.reference, branch: item.branch, refresh: true }).pipe(
    Effect.asVoid,
    Effect.catchCause((cause) => {
      if (isInterrupted(cause)) return Effect.interrupt
      return Effect.logWarning("failed to materialize reference repository", { name: item.name, cause })
    }),
  )
}
