export type ModeDirection = 1 | -1
export type ModeHandler = (direction: ModeDirection) => void

export interface ModeRouter {
  register: (handler: ModeHandler) => () => void
  dispatch: (direction: ModeDirection) => boolean
}

export function createModeRouter(): ModeRouter {
  const state: { handler?: ModeHandler } = {}

  return {
    register(handler) {
      state.handler = handler
      return () => {
        if (state.handler === handler) state.handler = undefined
      }
    },
    dispatch(direction) {
      const handler = state.handler
      if (!handler) return false
      handler(direction)
      return true
    },
  }
}
