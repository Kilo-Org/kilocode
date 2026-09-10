/**
 * Editable-region sizing for Next Edit. Per the Mercury docs, region size
 * dominates output latency; centering [-5, +10] around the cursor is the
 * recommended starting point. (The Mercury prompt sentinel tokens live in the
 * gateway — see packages/kilo-gateway/src/edit-prompt.ts.)
 */
export const DEFAULT_EDITABLE_REGION_TOP_MARGIN = 5
export const DEFAULT_EDITABLE_REGION_BOTTOM_MARGIN = 10
export const MAX_EDITABLE_REGION_LINES = 25
