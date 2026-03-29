// kilocode_change - new file
export namespace SessionInterrupt {
  type Item = {
    sessionID: string
    id: string
    kill(): Promise<void>
  }

  const state = new Map<string, Item>()

  export async function register(input: Item) {
    state.set(input.id, input)
  }

  export async function unregister(id: string) {
    state.delete(id)
  }

  export async function cancel(input: { sessionID: string; partID: string }) {
    const item = state.get(input.partID)
    if (!item || item.sessionID !== input.sessionID) return false
    await item.kill()
    return true
  }
}
