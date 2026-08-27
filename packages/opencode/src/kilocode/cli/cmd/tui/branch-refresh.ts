import type { VcsInfo } from "@kilocode/sdk/v2"

type Scope = {
  workspace?: string
  directory?: string
  project?: string
}

type Input = {
  get: (input: { workspace?: string; directory?: string }) => Promise<{ data?: VcsInfo }>
  apply: (data: VcsInfo) => void
  scope: () => Scope
  ready: () => boolean
}

export function create(input: Input) {
  const state = { version: 0, disposed: false }

  async function refresh() {
    if (state.disposed) return
    const version = ++state.version
    const scope = input.scope()
    if (!scope.directory || !scope.project || !input.ready()) return

    const route = scope.workspace ? { workspace: scope.workspace } : { directory: scope.directory }
    const result = await input.get(route)
    const current = input.scope()
    if (
      !result.data ||
      !input.ready() ||
      state.disposed ||
      version !== state.version ||
      current.workspace !== scope.workspace ||
      current.directory !== scope.directory ||
      current.project !== scope.project
    )
      return

    input.apply(result.data)
  }

  function dispose() {
    state.disposed = true
    state.version += 1
  }

  return { refresh, dispose }
}
