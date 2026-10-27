import path from "path"
import { Effect, Schema } from "effect"
import { Process } from "@/util/process"
import { Git } from "@/git"
import { primaryWorktree } from "@/kilocode/primary-worktree"

export namespace WorktreeStack {
  export class Error extends Schema.TaggedErrorClass<Error>()("WorktreeStack.Error", {
    message: Schema.String,
  }) {}

  const Count = Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
  export const Node = Schema.Struct({
    worktreeID: Schema.String,
    branch: Schema.NullOr(Schema.String),
    path: Schema.String,
    parentBranch: Schema.NullOr(Schema.String),
    parentWorktreeID: Schema.NullOr(Schema.String),
    state: Schema.Literals(["root", "attached", "detached"]),
    git: Schema.Struct({
      ahead: Count,
      behind: Count,
      conflicts: Schema.Union([Schema.Boolean, Schema.Literal("unknown")]),
    }),
    pullRequest: Schema.optional(
      Schema.Struct({
        number: Schema.Int,
        url: Schema.String,
        state: Schema.Literals(["open", "closed", "merged"]),
        base: Schema.String,
      }),
    ),
  })
  export const Forest = Schema.Struct({
    nodes: Schema.Array(Node),
    roots: Schema.Array(Schema.String),
    diagnostics: Schema.Array(
      Schema.Struct({
        code: Schema.Literals(["cycle", "self-edge"]),
        worktreeIDs: Schema.Array(Schema.String),
      }),
    ),
  })

  const Metadata = Schema.Struct({
    parentBranch: Schema.optional(Schema.String),
    pooled: Schema.optional(Schema.Boolean),
  })
  const State = Schema.Struct({
    worktrees: Schema.Record(
      Schema.String,
      Schema.Struct({
        path: Schema.String,
        parentBranch: Schema.optional(Schema.String),
        order: Schema.optional(Schema.Number),
      }),
    ),
    worktreeOrder: Schema.optional(Schema.Array(Schema.String)),
  })
  const PullRequests = Schema.Array(
    Schema.Struct({
      headRefName: Schema.String,
      number: Schema.Int,
      url: Schema.String,
      state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
      baseRefName: Schema.String,
    }),
  )
  type Mutable<T> = { -readonly [K in keyof T]: T[K] }
  type Item = Mutable<Omit<typeof Node.Type, "git">> & { git: Mutable<typeof Node.Type.git> }

  const json = <S extends Schema.Top>(file: string, schema: S) =>
    Effect.tryPromise(() => Bun.file(file).json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.catch(() => Effect.succeed(undefined)),
    )

  export const read = Effect.fn("WorktreeStack.read")(function* (directory: string) {
    const git = yield* Git.Service
    const root = yield* primaryWorktree(directory)
    if (!root)
      return yield* new Error({ message: `Cannot read worktree stack: ${directory} is not a readable Git checkout.` })
    const listing = yield* git.run(["worktree", "list", "--porcelain", "-z"], { cwd: directory })
    if (listing.exitCode !== 0 || listing.truncated)
      return yield* new Error({
        message: `Cannot list worktrees for ${directory}: ${listing.stderr.toString("utf8") || "incomplete Git output"}`,
      })
    const state = yield* json(path.join(root, ".kilo", "agent-manager.json"), State)
    const recorded = new Map(
      Object.entries(state?.worktrees ?? {}).map(([id, item]) => [
        path.resolve(item.path),
        {
          ...item,
          order:
            state?.worktreeOrder?.indexOf(id) === -1 ? undefined : (state?.worktreeOrder?.indexOf(id) ?? item.order),
        },
      ]),
    )
    const entries = listing
      .text()
      .split("\0\0")
      .filter(Boolean)
      .flatMap((record) => {
        const fields = record.split("\0")
        const dir = fields.find((field) => field.startsWith("worktree "))?.slice(9)
        if (!dir || fields.includes("bare")) return []
        return [
          {
            path: path.resolve(dir),
            branch: fields.find((field) => field.startsWith("branch refs/heads/"))?.slice(18) ?? null,
          },
        ]
      })
    const nodes: Item[] = []
    for (const entry of entries) {
      const config = entry.branch
        ? yield* git.run(["config", "--local", "--get", `branch.${entry.branch}.kilo-stack-parent`], { cwd: root })
        : undefined
      if (config && config.exitCode !== 0 && config.exitCode !== 1)
        return yield* new Error({
          message: `Cannot read stack parent for ${entry.branch}: ${config.stderr.toString("utf8")}`,
        })
      const admin = yield* git.run(
        ["rev-parse", "--path-format=absolute", "--git-path", "kilo-agent-manager-metadata.json"],
        { cwd: entry.path },
      )
      const metadata = admin.exitCode === 0 ? yield* json(admin.text().replace(/\r?\n$/, ""), Metadata) : undefined
      const legacy =
        metadata ??
        (yield* json(path.join(entry.path, ".kilo", "metadata.json"), Metadata)) ??
        (yield* json(path.join(entry.path, ".kilocode", "metadata.json"), Metadata))
      const saved = recorded.get(entry.path)
      const explicit = config?.exitCode === 0
      const relative = path.relative(root, entry.path).split(path.sep)
      const managed =
        (relative.at(0) === ".kilo" && relative.at(1) === "worktrees") ||
        (relative.at(0) === ".kilocode" && relative.at(1) === "worktrees")
      const pooled = metadata?.pooled === true
      if (pooled && !explicit && !saved) continue
      if (entry.path !== root && !explicit && !saved && (!managed || pooled) && !legacy) continue
      const parent = explicit ? config.text().replace(/\r?\n$/, "") : (legacy?.parentBranch ?? saved?.parentBranch)
      nodes.push({
        worktreeID: entry.path,
        path: entry.path,
        branch: entry.branch,
        parentBranch: parent ?? null,
        parentWorktreeID: null,
        state: parent == null ? "root" : "detached",
        git: {
          ahead: parent == null ? 0 : null,
          behind: parent == null ? 0 : null,
          conflicts: parent == null ? false : "unknown",
        },
      })
    }
    nodes.sort((a, b) =>
      a.path === root
        ? -1
        : b.path === root
          ? 1
          : (recorded.get(a.path)?.order ?? Infinity) - (recorded.get(b.path)?.order ?? Infinity) ||
            a.path.localeCompare(b.path),
    )
    const branches = new Map(nodes.filter((node) => node.branch != null).map((node) => [node.branch, node]))
    const paths = new Map(nodes.map((node) => [node.path, node]))
    for (const node of nodes) {
      const parent = branches.get(node.parentBranch)
      if (!parent) continue
      node.parentWorktreeID = parent.worktreeID
      node.state = "attached"
    }
    const diagnostics: (typeof Forest.Type)["diagnostics"][number][] = []
    const visited = new Set<string>()
    for (const node of nodes) {
      const chain = new Map<string, number>()
      const trail: Item[] = []
      let current: Item | undefined = node
      while (current && !visited.has(current.path)) {
        const index = chain.get(current.path)
        if (index != null) {
          const cycle = trail.slice(index)
          diagnostics.push({
            code: cycle.length === 1 ? "self-edge" : "cycle",
            worktreeIDs: cycle.map((item) => item.path),
          })
          for (const item of cycle) {
            item.parentWorktreeID = null
            item.state = "detached"
          }
          break
        }
        chain.set(current.path, trail.length)
        trail.push(current)
        current = current.parentWorktreeID == null ? undefined : paths.get(current.parentWorktreeID)
      }
      for (const item of trail) visited.add(item.path)
    }
    for (const node of nodes) {
      if (!node.branch || node.parentBranch == null) continue
      const tips = yield* Effect.forEach([node.parentBranch, node.branch], (branch) =>
        git.run(["rev-parse", "--verify", `refs/heads/${branch}^{commit}`], { cwd: root }),
      )
      if (tips.some((tip) => tip.exitCode !== 0)) continue
      const parent = tips.at(0)!.text().trim()
      const child = tips.at(1)!.text().trim()
      const counts = yield* git.run(["rev-list", "--left-right", "--count", `${parent}...${child}`], { cwd: root })
      const values = counts.text().trim().split(/\s+/).map(Number)
      if (
        counts.exitCode === 0 &&
        values.length === 2 &&
        values.every((value) => Number.isSafeInteger(value) && value >= 0)
      ) {
        node.git.behind = values.at(0)!
        node.git.ahead = values.at(1)!
      }
      const merge = yield* git.run(["merge-tree", "--write-tree", parent, child], { cwd: root })
      node.git.conflicts =
        merge.exitCode === 0
          ? false
          : merge.exitCode === 1 && /^[0-9a-f]{40,64}\n/.test(merge.text())
            ? true
            : "unknown"
    }
    const prs = yield* Effect.tryPromise((signal) =>
      Process.run(
        ["gh", "pr", "list", "--state", "all", "--limit", "1000", "--json", "headRefName,number,url,state,baseRefName"],
        {
          cwd: root,
          env: { GH_PROMPT_DISABLED: "1" },
          abort: signal,
          nothrow: true,
        },
      ),
    ).pipe(
      Effect.timeout("5 seconds"),
      Effect.flatMap((result) =>
        result.code === 0
          ? Schema.decodeUnknownEffect(Schema.fromJsonString(PullRequests))(result.stdout.toString("utf8"))
          : Effect.succeed(undefined),
      ),
      Effect.catch(() => Effect.succeed(undefined)),
    )
    for (const node of nodes) {
      const pr =
        prs?.find((pr) => pr.headRefName === node.branch && pr.state === "OPEN") ??
        prs?.find((pr) => pr.headRefName === node.branch)
      if (pr)
        node.pullRequest = {
          number: pr.number,
          url: pr.url,
          state: pr.state.toLowerCase() as "open" | "closed" | "merged",
          base: pr.baseRefName,
        }
    }
    const roots = nodes.filter((node) => node.parentWorktreeID == null).map((node) => node.path)
    const ordered: (typeof Node.Type)[] = []
    const visit = (id: string) => {
      ordered.push(paths.get(id)!)
      for (const node of nodes) if (node.parentWorktreeID === id) visit(node.path)
    }
    for (const id of roots) visit(id)
    return { nodes: ordered, roots, diagnostics } satisfies typeof Forest.Type
  })
}
