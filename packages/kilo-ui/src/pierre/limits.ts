// A file this large renders through Pierre's line virtualizer instead of being drawn in one pass. The review panel
// open policy shares these limits so eager and virtualized diffs agree on what counts as extreme.
export const EXTREME_DIFF_CHANGED_LINES = 2_000
export const MAX_EAGER_DIFF_BYTES = 256 * 1024
