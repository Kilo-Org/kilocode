import path from "path"
import { ConfigReference } from "@opencode-ai/core/config/reference"
import { Global } from "@opencode-ai/core/global"
import { parseRepositoryReference, repositoryCachePath, type RemoteReference } from "@/util/repository"
import { Effect } from "effect"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { Reference } from "@opencode-ai/core/reference"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { isInterrupted } from "@/kilocode/effect/cause"

export type Resolved =
  | {
      name: string
      kind: "local"
      path: string
      description?: string
      hidden?: boolean
    }
  | {
      name: string
      kind: "git"
      repository: string
      reference: RemoteReference
      path: string
      branch?: string
      description?: string
      hidden?: boolean
    }
  | {
      name: string
      kind: "invalid"
      repository?: string
      message: string
    }

type Normalized =
  | { kind: "local"; path: string; description?: string; hidden?: boolean }
  | { kind: "git"; repository: string; branch?: string; description?: string; hidden?: boolean }
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
  if ("path" in entry) {
    return { kind: "local", path: entry.path, description: entry.description, hidden: entry.hidden }
  }
  return {
    kind: "git",
    repository: entry.repository,
    branch: entry.branch,
    description: entry.description,
    hidden: entry.hidden,
  }
}

function local(input: { directory: string; worktree: string; value: string }) {
  if (input.value.startsWith("~/")) return path.join(Global.Path.home, input.value.slice(2))
  if (path.isAbsolute(input.value)) return input.value
  return path.resolve(input.worktree === "/" ? input.directory : input.worktree, input.value)
}

function resolve(name: string, entry: Normalized, directory: string, worktree: string): Resolved {
  if (entry.kind === "invalid") return { name, kind: "invalid", message: entry.message }
  if (entry.kind === "local") {
    return {
      name,
      kind: "local",
      path: local({ directory, worktree, value: entry.path }),
      description: entry.description,
      hidden: entry.hidden,
    }
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
    description: entry.description,
    hidden: entry.hidden,
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

// Keep Core V2 tools on the same effective Kilo config used by stable tools. Core's standalone
// scanner cannot see account/managed config or KILO_CONFIG_CONTENT, so replace its provisional
// references after both config systems finish booting.
export const sync = Effect.fn("KiloReference.sync")(function* (input: {
  references: ConfigReference.Info
  directory: string
  worktree: string
}) {
  const service = yield* Reference.Service
  const entries = resolveAll(input)
  if (entries.length === 0 && (yield* service.list()).length === 0) return
  const sources = entries.flatMap<readonly [string, Reference.Source]>((item) => {
    if (item.kind === "invalid") return []
    if (item.kind === "local") {
      return [
        [
          item.name,
          new Reference.LocalSource({
            type: "local",
            path: AbsolutePath.make(item.path),
            description: item.description,
            hidden: item.hidden,
          }),
        ] as const,
      ]
    }
    return [
      [
        item.name,
        new Reference.GitSource({
          type: "git",
          repository: item.repository,
          branch: item.branch,
          description: item.description,
          hidden: item.hidden,
        }),
      ] as const,
    ]
  })
  yield* service.replace(sources)
})
