type Props = {
  tool?: string
  callID?: string
  partID?: string
}

const MAX = 2000
const state = new Map<string, boolean>()

export function toolOpenKey(props: Props) {
  const id = props.callID || props.partID
  if (!id) return
  if (!props.tool) return id
  return `${props.tool}:${id}`
}

export function readToolOpen(key: string | undefined, fallback: boolean | undefined) {
  if (key && state.has(key)) return state.get(key)
  return fallback
}

export function writeToolOpen(key: string | undefined, value: boolean) {
  if (!key) return
  if (!state.has(key) && state.size >= MAX) {
    const first = state.keys().next().value
    if (first) state.delete(first)
  }
  state.set(key, value)
}

export function resetToolOpenState() {
  state.clear()
}
