/** Resolve websearch provider flags from runtime env flags + config. */
export function webSearchFlags(
  flags: { enableExa: boolean; enableParallel: boolean },
  cfg?: { experimental?: { enable_exa?: boolean } },
) {
  return {
    exa: flags.enableExa || cfg?.experimental?.enable_exa === true,
    parallel: flags.enableParallel,
  }
}
