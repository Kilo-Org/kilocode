export type CloudRepository = { type: "github"; repo: string } | { type: "gitlab"; url: string }

export type CloudRepositoryContext = {
  repository: CloudRepository
  label: string
  name: string
  gitUrl: string
}

export class CloudRepositoryUnavailableError extends Error {}

type Origin = {
  host: "github.com" | "gitlab.com"
  path: string
}

const UNSUPPORTED = "The workspace origin must be a supported GitHub or GitLab repository"

export async function resolveCloudRepository(
  cwd: string | undefined,
  remoteUrl: (cwd: string, remote?: string) => Promise<string | undefined>,
): Promise<CloudRepositoryContext> {
  if (!cwd) throw new CloudRepositoryUnavailableError("A workspace repository is required")
  const remote = await remoteUrl(cwd, "origin")
  if (!remote) throw new CloudRepositoryUnavailableError("The workspace repository does not have an origin remote")

  const origin = parse(remote)
  const label = `${origin.host}/${origin.path}`
  const gitUrl = `https://${label.toLowerCase()}`
  if (origin.host === "github.com") {
    return { repository: { type: "github", repo: origin.path }, label, name: origin.path, gitUrl }
  }
  return {
    repository: { type: "gitlab", url: `https://gitlab.com/${origin.path}.git` },
    label,
    name: origin.path,
    gitUrl,
  }
}

function parse(remote: string): Origin {
  const scp = /^git@([^/:]+):(.+)$/.exec(remote)
  if (scp) return build(host(scp[1]!), scp[2]!)

  const url = toUrl(remote)
  const ssh = url.protocol === "ssh:"
  const auth = ssh ? url.username === "git" && !url.password : !url.username && !url.password
  if ((url.protocol !== "https:" && !ssh) || !auth || url.search || url.hash || port(remote) || traversal(remote)) {
    throw new CloudRepositoryUnavailableError(UNSUPPORTED)
  }
  return build(host(url.hostname), url.pathname.replace(/^\//, ""))
}

function host(value: string): Origin["host"] {
  const hostname = value.toLowerCase()
  if (hostname !== "github.com" && hostname !== "gitlab.com") throw new CloudRepositoryUnavailableError(UNSUPPORTED)
  return hostname
}

function build(host: Origin["host"], path: string): Origin {
  const clean = path.endsWith(".git") ? path.slice(0, -4) : path
  const parts = clean.split("/")
  const count = host === "github.com" ? parts.length === 2 : parts.length >= 2
  const valid =
    count &&
    !path.endsWith("/") &&
    parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..")
  if (!valid) throw new CloudRepositoryUnavailableError(UNSUPPORTED)
  return { host, path: clean }
}

function toUrl(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new CloudRepositoryUnavailableError(UNSUPPORTED)
  }
}

function port(value: string): boolean {
  const authority = /^[a-z]+:\/\/([^/]*)/i.exec(value)?.[1]
  return authority?.split("@").at(-1)?.includes(":") ?? false
}

function traversal(value: string): boolean {
  return /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)
}
