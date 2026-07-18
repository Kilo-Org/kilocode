/**
 * Project-message handlers for ticket #12353 (Add project flow + multi-project
 * accordion sidebar).
 *
 * The handlers below are thin vscode-free wrappers around `ProjectRouting`
 * mutations: they only need access to the routing instance plus the host and
 * post-to-webview callbacks. Kept in a separate module so `AgentManagerProvider`
 * stays under the 2000-line cap and so the routing layer can be exercised
 * without instantiating a full provider.
 */

import type { ProjectRouting } from "./project-routing"

export interface ProjectMessageDeps {
  routing: ProjectRouting
  postToWebview: (msg: unknown) => void
  showError: (msg: string) => void
  log: (...args: unknown[]) => void
  pickFolder: (opts?: { title?: string; openLabel?: string }) => Promise<unknown | undefined>
  addFolderToWorkspace: (path: string) => void
  pushState: () => void
}

export async function handleAddProject(deps: ProjectMessageDeps): Promise<void> {
  const picked = await deps.pickFolder({
    title: "Add project to Agent Manager",
    openLabel: "Add Project",
  })
  if (!picked) return
  const result = await deps.routing.addProject(picked)
  if (!result.ok) {
    deps.showError(result.error.message)
    deps.log(`Add project failed: ${result.error.code} ${result.error.message}`)
    return
  }
  if (result.deduplicated) {
    deps.postToWebview({
      type: "agentManager.projectToast",
      level: "info",
      message: `Project already registered: ${result.project.root}`,
    })
  } else {
    deps.log(`Registered project ${result.project.id} (${result.project.root})`)
  }
  deps.pushState()
}

export async function handleToggleProjectCollapsed(
  projectId: string,
  collapsed: boolean | undefined,
  deps: ProjectMessageDeps,
): Promise<void> {
  if (!deps.routing.getProject(projectId)) return
  await deps.routing.toggleProjectCollapsed(projectId, collapsed)
  deps.pushState()
}

export function handleAddProjectToWorkspace(projectId: string, deps: ProjectMessageDeps): void {
  const project = deps.routing.getProject(projectId)
  if (!project) return
  deps.addFolderToWorkspace(project.root)
}
