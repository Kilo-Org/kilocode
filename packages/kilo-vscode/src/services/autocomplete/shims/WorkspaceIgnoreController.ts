import path from "node:path"
import { FileIgnoreController } from "./FileIgnoreController"
import { folderFor } from "../../../workspace-folders"

/**
 * Applies each workspace folder's own .kilocodeignore (or .gitignore) rules.
 *
 * A single FileIgnoreController denies every path outside its folder, which in
 * a multi-root window switched autocomplete off for all folders but the
 * first. This checks a path against the controller of the folder containing
 * it (the deepest when folders nest). Paths outside every folder stay denied.
 * Folders added later are loaded on first use and denied until they are.
 */
export class WorkspaceIgnoreController extends FileIgnoreController {
  private folders = new Map<string, FileIgnoreController>()
  private readonly loading = new Set<string>()

  constructor(private readonly roots: () => string[]) {
    super()
  }

  override async initialize(): Promise<void> {
    const next = new Map<string, FileIgnoreController>()
    await Promise.all(
      this.roots().map(async (root) => {
        const controller = new FileIgnoreController(root)
        await controller.initialize()
        next.set(root, controller)
      }),
    )
    for (const controller of this.folders.values()) controller.dispose()
    this.folders = next
  }

  override validateAccess(filePath: string): boolean {
    const roots = this.roots()
    // A single folder behaves exactly like its own FileIgnoreController.
    if (roots.length < 2) return this.single(roots.at(0), filePath)
    const plain = filePath.replace(/^file:\/\/\/?(?=[a-zA-Z]:|\/)/, "")
    const target =
      path.isAbsolute(plain) || /^[a-zA-Z]:[/\\]/.test(plain) ? plain : path.resolve(roots.at(0) ?? "", plain)
    const root = folderFor(target, roots)
    if (!root) return false
    const controller = this.folders.get(root)
    if (controller) return controller.validateAccess(target)
    this.load(root)
    return false
  }

  override dispose(): void {
    for (const controller of this.folders.values()) controller.dispose()
    this.folders.clear()
  }

  private single(root: string | undefined, filePath: string): boolean {
    if (!root) return false
    const controller = this.folders.get(root)
    if (controller) return controller.validateAccess(filePath)
    this.load(root)
    return false
  }

  private load(root: string) {
    if (this.loading.has(root)) return
    this.loading.add(root)
    const controller = new FileIgnoreController(root)
    controller
      .initialize()
      .then(() => this.folders.set(root, controller))
      .catch((err: unknown) => console.error("[Kilo New] Autocomplete: failed to load ignore rules for", root, err))
      .finally(() => this.loading.delete(root))
  }
}
