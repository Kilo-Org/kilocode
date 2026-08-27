import type { GlobalEvent } from "@kilocode/sdk/v2"

type Scope = {
  workspace?: string
  directory?: string
  project?: string
}

type Input = {
  get: (input: { workspace?: string; directory?: string }) => Promise<{ data?: { branch?: string } }>
  emit: (type: "event", event: GlobalEvent) => void
  scope: () => Scope
  branch: () => string | undefined
}

export function create(input: Input) {
  const state = { version: 0, disposed: false }

  async function refresh() {
    if (state.disposed) return
    const version = ++state.version
    const scope = input.scope()
    if (!scope.directory || !scope.project) return

    const route = scope.workspace ? { workspace: scope.workspace } : { directory: scope.directory }
    const result = await input.get(route)
    const current = input.scope()
    if (
      !result.data ||
      state.disposed ||
      version !== state.version ||
      current.workspace !== scope.workspace ||
      current.directory !== scope.directory ||
      current.project !== scope.project
    )
      return

    const branch = result.data.branch
    if (input.branch() === branch) return
    input.emit("event", {
      directory: scope.directory,
      project: scope.project,
      ...(scope.workspace ? { workspace: scope.workspace } : {}),
      payload: {
        id: `vcs-refresh-${crypto.randomUUID()}`,
        type: "vcs.branch.updated",
        properties: { branch },
      },
    })
  }

  function dispose() {
    state.disposed = true
    state.version += 1
  }

  return { refresh, dispose }
}
