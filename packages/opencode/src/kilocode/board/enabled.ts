export namespace BoardEnabled {
  /**
   * Resolve the effective shared agent board state.
   *
   * The board is enabled by default. It is disabled only by an explicit opt-out:
   * `experimental.shared_agent_board` set to `false` in config, or the
   * `KILO_EXPERIMENTAL_SHARED_AGENT_BOARD` flag set to a falsy boolean. Either
   * explicit disable wins over an explicit enable.
   */
  export function resolve(input: { config?: boolean; flag?: boolean }) {
    if (input.config === false) return false
    if (input.flag === false) return false
    return true
  }
}
