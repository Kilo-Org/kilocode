import * as path from "path"
import type * as vscode from "vscode"
import simpleGit from "simple-git"
import { canonicalizePath, projectIdFor, resolveProjectRoot, samePath } from "./agent-manager/project/paths"
import { ProjectRegistry } from "./agent-manager/project/registry"

const KEY = "kilo.indexingConsent.v1"

interface File {
  version: 1
  projects: Record<string, boolean>
}

export interface IndexingProject {
  id: string
  root: string
  label: string
}

interface Storage {
  read(): unknown
  write(value: unknown): PromiseLike<void> | void
}

function parse(raw: unknown): File {
  if (!raw || typeof raw !== "object") return { version: 1, projects: {} }
  const file = raw as Partial<File>
  if (file.version !== 1 || !file.projects || typeof file.projects !== "object") {
    return { version: 1, projects: {} }
  }
  return {
    version: 1,
    projects: Object.fromEntries(Object.entries(file.projects).filter((entry) => typeof entry[1] === "boolean")),
  }
}

export class IndexingConsentStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: Storage,
    private readonly resolve: (dir: string) => Promise<string | undefined>,
  ) {}

  async project(dir: string): Promise<IndexingProject> {
    const root = (await this.resolve(dir)) ?? canonicalizePath(dir)
    return { id: projectIdFor(root), root, label: path.basename(root) }
  }

  enabled(id: string): boolean {
    return parse(this.storage.read()).projects[id] === true
  }

  set(id: string, enabled: boolean): Promise<void> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const file = parse(this.storage.read())
        await this.storage.write({ ...file, projects: { ...file.projects, [id]: enabled } })
      })
    this.queue = task.then(
      () => {},
      () => {},
    )
    return task
  }

  async list(primary: string | undefined, extras: Array<{ root: string; label?: string }>): Promise<IndexingProject[]> {
    const dirs = [...(primary ? [{ root: primary }] : []), ...extras]
    const projects = await Promise.all(
      dirs.map(async (entry) => ({
        ...(await this.project(entry.root)),
        label: entry.label ?? path.basename(entry.root),
      })),
    )
    return projects.filter(
      (project, index) => !projects.slice(0, index).some((item) => samePath(item.root, project.root)),
    )
  }
}

const stores = new WeakMap<vscode.ExtensionContext, IndexingConsentStore>()

export function indexingConsentStore(context: vscode.ExtensionContext): IndexingConsentStore {
  const existing = stores.get(context)
  if (existing) return existing
  const storage = {
    read: () => context.globalState.get(KEY),
    write: (value: unknown) => context.globalState.update(KEY, value),
  }
  const store = new IndexingConsentStore(storage, (dir) =>
    resolveProjectRoot(dir, (cwd, args) => simpleGit(cwd).raw(args)),
  )
  stores.set(context, store)
  return store
}

export function registeredProjects(context: vscode.ExtensionContext) {
  return (
    new ProjectRegistry({
      read: () => context.globalState.get("agentManager.projects"),
      write: (value) => Promise.resolve(context.globalState.update("agentManager.projects", value)),
    })
      .list()
      // Consent must never be offered for a repository the user has not trusted:
      // enabling indexing sends the directory to the backend for reading.
      .filter((project) => project.trusted)
  )
}
