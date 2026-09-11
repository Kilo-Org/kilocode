export namespace BoardEnabled {
  /**
   * Resolve the effective shared agent board state.
   *
   * The `experimental.shared_agent_board` config key is the source of truth for
   * an explicit enable. The experimental environment flag is an additional
   * enable path, so an explicit config `false` does not turn the board off when
   * the flag is set.
   */
  export function resolve(input: { config?: boolean; flag?: boolean }) {
    return input.config === true || input.flag === true
  }
}
