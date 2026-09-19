import * as path from "node:path"
import type { GitOps } from "../GitOps"
import type { Host } from "../host"
import { canonicalizePath, resolveProjectRoot } from "./paths"
import { isRestrictedRoot } from "../home-workspace"
import * as prepare from "./prepare"
import { repoName } from "./clone"

export type OnboardKind = "new" | "local" | "clone"

export interface Onboarding {
  host: Pick<Host, "input" | "confirm" | "cloneRepository" | "isTrusted" | "notify">
  pickFolder: Host["pickFolder"]
  primary?: string
  git: GitOps
  enabled: () => boolean
  /** True when the folder already resolves to a registered project. */
  registered: (dir: string) => boolean
}

function trusted(deps: Onboarding) {
  if (!deps.enabled()) throw new Error("Multi-project Agent Manager is disabled.")
  if (!deps.host.isTrusted()) throw new Error("Trust this VS Code window before creating or initializing a repository.")
}

/** Default parent folder: the primary checkout's parent. */
export async function defaultParent(primary: string | undefined, git: GitOps): Promise<string | undefined> {
  if (!primary) return undefined
  const root = await resolveProjectRoot(primary, prepare.runner(git))
  return path.dirname(root ?? primary)
}

/** Collect a repository-local Git identity when none is configured. */
async function identify(root: string, deps: Onboarding): Promise<boolean> {
  const host = deps.host
  if (await prepare.identity(root, deps.git)) return true
  const name = await host.input({
    title: "Git user name",
    prompt: `Name for commits in ${root}`,
    validate: (value) => (value.trim() && !/[\x00-\x1f<>]/.test(value) ? undefined : "Enter a valid Git user name."),
  })
  const email =
    name &&
    (await host.input({
      title: "Git email",
      prompt: `Email for commits in ${root}`,
      validate: (value) => (value.trim() && !/[\s<>\x00-\x1f]/.test(value) ? undefined : "Enter a valid Git email."),
    }))
  if (
    !name ||
    !email ||
    !(await host.confirm(`Save this Git identity only in ${root}?\n${name} <${email}>`, "Save identity"))
  ) {
    host.notify("info", `The repository remains at ${root}. Add this folder again to finish its initial commit.`)
    return false
  }
  trusted(deps)
  await prepare.configure(root, deps.git, {
    name: name.trim(),
    email: email.trim(),
  })
  return true
}

/** Inspect a chosen folder, optionally initialize it, and create an empty first commit. */
async function prepareTarget(
  dir: string,
  kind: OnboardKind,
  deps: Onboarding,
  created = false,
): Promise<string | undefined> {
  const host = deps.host
  try {
    const state = await prepare.inspect(dir, deps.git)
    if (isRestrictedRoot(state.root ?? (canonicalizePath(dir) || path.parse(dir).root))) {
      throw new Error("Select a project folder, not your home folder or a filesystem root.")
    }
    if (state.root && !state.empty) return state.root
    trusted(deps)
    if (
      !created &&
      !(await host.confirm(
        state.root
          ? `Create an empty first commit in ${state.root}? This bootstrap commit is unsigned and skips normal commit hooks. Existing files and staged changes will not be included. Only committed files appear in new worktrees. Nothing will be pushed.`
          : `Initialize Git in ${dir} and add this project? This creates an empty, unsigned first commit without normal commit hooks. Existing files stay uncommitted and will not appear in new worktrees until you commit them.`,
        state.root ? "Create initial commit and add" : "Initialize Git and add",
      ))
    ) {
      if (kind === "clone")
        host.notify("info", `The cloned repository remains at ${dir}. It was not added to Agent Manager.`)
      return
    }
    trusted(deps)
    const root = state.root ?? (await prepare.initialize(dir, deps.git))
    if (!(await identify(root, deps))) return
    trusted(deps)
    await prepare.commit(root, deps.git)
    return root
  } catch (err) {
    throw new Error(
      `Could not prepare the project at ${dir}. The folder has been kept. ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** Import an existing local folder through the native folder picker. */
export async function onboard(deps: Onboarding): Promise<string | undefined> {
  // Even an existing repository will be attached through state recovery and Git exclude writes.
  trusted(deps)
  const primary = await defaultParent(deps.primary, deps.git)
  const dir = await deps.pickFolder({
    defaultPath: primary,
    title: "Open local project",
  })
  if (!dir || !deps.enabled()) return
  trusted(deps)
  return prepareTarget(dir, "local", deps)
}

/**
 * Clone through VS Code into an explicit parent folder. A registered checkout
 * of the same repository opens instead of cloning again.
 */
export async function cloneProject(url: string, parent: string, deps: Onboarding): Promise<string | undefined> {
  trusted(deps)
  const name = repoName(url)
  const candidate = name ? path.join(parent, name) : undefined
  if (candidate && deps.registered(candidate)) return candidate
  const dir = await deps.host.cloneRepository(url, parent)
  if (!dir || !deps.enabled()) return
  trusted(deps)
  return prepareTarget(dir, "clone", deps)
}

/** Create a new local project inside an explicit parent folder. */
export async function createProject(parent: string, name: string, deps: Onboarding): Promise<string | undefined> {
  trusted(deps)
  const { root, created } = await prepare.create(parent, name, deps.git)
  return prepareTarget(root, "new", deps, created)
}
