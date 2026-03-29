// kilocode_change - new file
export namespace SessionInterrupt {
  type Item = {
    sessionID: string
    partID: string
    callID?: string
    kill(): Promise<void>
  }

  const state = new Map<string, Item>()

  export async function register(input: Item) {
    state.set(input.partID, input)
  }

  export async function unregister(partID: string) {
    state.delete(partID)
  }

  export async function cancel(input: { sessionID: string; partID: string }) {
    const item = state.get(input.partID)
    if (!item || item.sessionID !== input.sessionID) return false
    await item.kill()
    return true
  }

  export async function cancelCall(input: { sessionID: string; callID: string }) {
    for (const item of state.values()) {
      if (item.sessionID !== input.sessionID) continue
      if (item.callID !== input.callID) continue
      await item.kill()
      return true
    }
    return false
  }
}
