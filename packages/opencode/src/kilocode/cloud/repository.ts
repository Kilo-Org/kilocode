import { Effect, Schema } from "effect"
import { Git } from "@/git"

export namespace CloudRepository {
  export const RepositoryType = Schema.Literals(["github", "gitlab", "git"])
  export type RepositoryType = Schema.Schema.Type<typeof RepositoryType>

  const GitHub = Schema.Struct({
    type: Schema.Literal("github"),
    repo: Schema.String,
    branch: Schema.optional(Schema.String),
  })

  const GitLab = Schema.Struct({
    type: Schema.Literal("gitlab"),
    url: Schema.String,
    branch: Schema.optional(Schema.String),
  })

  const GitRepository = Schema.Struct({
    type: Schema.Literal("git"),
    url: Schema.String,
    branch: Schema.optional(Schema.String),
  })

  export const Output = Schema.Union([GitHub, GitLab, GitRepository])
  export type Output = Schema.Schema.Type<typeof Output>

  export type Input = {
    readonly cwd: string
    readonly repo?: string
    readonly type?: RepositoryType
    readonly branch?: string
  }

  export type ParseInput = {
    readonly repo: string
    readonly type?: RepositoryType
    readonly branch?: string
  }

  export class InvalidRepositoryError extends Schema.TaggedErrorClass<InvalidRepositoryError>()(
    "CloudRepositoryInvalidRepositoryError",
    { message: Schema.String },
  ) {}

  export class InvalidBranchError extends Schema.TaggedErrorClass<InvalidBranchError>()(
    "CloudRepositoryInvalidBranchError",
    { message: Schema.String },
  ) {}

  export class NotWorktreeError extends Schema.TaggedErrorClass<NotWorktreeError>()("CloudRepositoryNotWorktreeError", {
    message: Schema.String,
  }) {}

  export class NoRemoteError extends Schema.TaggedErrorClass<NoRemoteError>()("CloudRepositoryNoRemoteError", {
    message: Schema.String,
  }) {}

  export class AmbiguousRemoteError extends Schema.TaggedErrorClass<AmbiguousRemoteError>()(
    "CloudRepositoryAmbiguousRemoteError",
    { message: Schema.String },
  ) {}

  export class DiscoveryError extends Schema.TaggedErrorClass<DiscoveryError>()("CloudRepositoryDiscoveryError", {
    message: Schema.String,
  }) {}

  export type ParseError = InvalidRepositoryError | InvalidBranchError
  export type Error = ParseError | NotWorktreeError | NoRemoteError | AmbiguousRemoteError | DiscoveryError

  const shorthand = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
  const branch = /^[a-zA-Z0-9._\-/]+$/

  function invalid(message: string): never {
    throw new InvalidRepositoryError({ message })
  }

  function validate(value: string | undefined): string | undefined {
    if (value === undefined) return undefined
    if (
      value.length === 0 ||
      value.length > 255 ||
      !branch.test(value) ||
      value.startsWith("-") ||
      value.startsWith("/") ||
      value.endsWith("/") ||
      value.endsWith(".") ||
      value.includes("//") ||
      value.includes("..") ||
      value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
    ) {
      throw new InvalidBranchError({ message: "Repository branch must be a valid Git branch name" })
    }
    return value
  }

  function github(path: string) {
    const clean = path.startsWith("/") ? path.slice(1) : path
    const trimmed = clean.endsWith("/") ? clean.slice(0, -1) : clean
    const parts = trimmed.split("/")
    if (parts.length !== 2) return invalid("GitHub repository URL must contain exactly owner/repository")
    const owner = parts[0]
    const raw = parts[1]
    if (!owner || !raw) return invalid("GitHub repository URL must contain exactly owner/repository")
    const repo = raw.endsWith(".git") ? raw.slice(0, -4) : raw
    const value = `${owner}/${repo}`
    if (!shorthand.test(value) || [owner, repo].some((part) => part === "." || part === "..")) {
      return invalid("GitHub repository URL must contain a safe owner/repository value")
    }
    return value
  }

  function ssh(value: string): string | undefined {
    if (value.startsWith("ssh://")) {
      if (!URL.canParse(value)) return invalid("Repository SSH URL is invalid")
      const url = new URL(value)
      if (
        url.protocol !== "ssh:" ||
        url.hostname !== "github.com" ||
        url.hostname.endsWith(".") ||
        url.username !== "git" ||
        url.password !== "" ||
        url.port !== ""
      ) {
        return invalid("Only standard GitHub SSH repository URLs are supported")
      }
      return github(url.pathname)
    }

    const match = value.match(/^([^@/\s]+)@([^:/\s]+):(.+)$/)
    if (!match) return undefined
    const host = match[2].toLowerCase()
    if (match[1] !== "git" || host !== "github.com" || host.endsWith(".")) {
      return invalid("Only standard GitHub SCP repository URLs are supported")
    }
    return github(match[3])
  }

  function https(value: string) {
    if (!value.startsWith("https://") || !URL.canParse(value)) {
      return invalid("Repository URL must be a valid HTTPS URL")
    }
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hostname.endsWith(".") ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return invalid("Repository URL must not include credentials, query strings, or fragments")
    }
    return url
  }

  function parsed(input: ParseInput) {
    return Effect.try({
      try: () => parse(input),
      catch: (error) => {
        if (error instanceof InvalidRepositoryError || error instanceof InvalidBranchError) return error
        return new InvalidRepositoryError({ message: "Repository is invalid" })
      },
    })
  }

  export function parse(input: ParseInput): Output {
    const ref = input.repo
    const name = validate(input.branch)
    const short = shorthand.test(ref) ? ref : undefined
    if (short) {
      const parts = short.split("/")
      if (parts.some((part) => part === "." || part === "..")) {
        return invalid("GitHub shorthand must contain a safe owner/repository value")
      }
      if (input.type !== undefined && input.type !== "github") {
        return invalid("GitHub shorthand is only compatible with repository type github")
      }
      return { type: "github", repo: short, ...(name === undefined ? {} : { branch: name }) }
    }

    const secure = ssh(ref)
    if (secure !== undefined) {
      if (input.type !== undefined && input.type !== "github") {
        return invalid("GitHub SSH repositories are only compatible with repository type github")
      }
      return { type: "github", repo: secure, ...(name === undefined ? {} : { branch: name }) }
    }

    const url = https(ref)
    const host = url.hostname.toLowerCase()
    if (host === "github.com") {
      if (input.type !== undefined && input.type !== "github") {
        return invalid("github.com URLs are only compatible with repository type github")
      }
      if (url.port !== "") return invalid("Repository type github requires a standard github.com URL")
      return { type: "github", repo: github(url.pathname), ...(name === undefined ? {} : { branch: name }) }
    }
    if (input.type === "github") return invalid("Repository type github requires a standard github.com URL")
    const type = input.type ?? (host === "gitlab.com" ? "gitlab" : "git")
    return { type, url: url.toString(), ...(name === undefined ? {} : { branch: name }) }
  }

  export const resolve = Effect.fn("CloudRepository.resolve")(function* (input: Input) {
    if (input.repo !== undefined) {
      return yield* parsed({
        repo: input.repo,
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.branch === undefined ? {} : { branch: input.branch }),
      })
    }

    const git = yield* Git.Service
    const tree = yield* git.run(["rev-parse", "--is-inside-work-tree"], { cwd: input.cwd })
    if (tree.exitCode !== 0 || tree.text().trim() !== "true") {
      return yield* Effect.fail(new NotWorktreeError({ message: "Current directory is not inside a Git worktree" }))
    }

    const listed = yield* git.run(["remote"], { cwd: input.cwd })
    if (listed.exitCode !== 0) {
      return yield* Effect.fail(new DiscoveryError({ message: "Unable to inspect Git remotes" }))
    }
    const remotes = listed
      .text()
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (remotes.length === 0) {
      return yield* Effect.fail(new NoRemoteError({ message: "Current Git worktree has no remotes" }))
    }

    const current = yield* git.branch(input.cwd)
    const tracking = yield* Effect.gen(function* () {
      if (!current) return undefined
      const result = yield* git.run(["config", "--get", `branch.${current}.remote`], { cwd: input.cwd })
      if (result.exitCode !== 0) return undefined
      const name = result.text().trim()
      if (!remotes.includes(name)) return undefined
      return name
    })
    const remote = tracking ?? (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : undefined)
    if (!remote) {
      return yield* Effect.fail(
        new AmbiguousRemoteError({ message: "Current Git worktree has multiple remotes and none can be selected" }),
      )
    }

    const fetched = yield* git.run(["remote", "get-url", remote], { cwd: input.cwd })
    const text = fetched.text()
    const ref = text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text
    if (fetched.exitCode !== 0 || !ref) {
      return yield* Effect.fail(new DiscoveryError({ message: "Unable to read the selected Git remote fetch URL" }))
    }
    if (shorthand.test(ref)) {
      return yield* Effect.fail(new InvalidRepositoryError({ message: "Local repository remotes are not supported" }))
    }

    return yield* parsed({
      repo: ref,
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.branch === undefined ? {} : { branch: input.branch }),
    })
  })
}
