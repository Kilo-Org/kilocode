import { File as Base, type FileProps } from "@opencode-ai/ui/file"
import { type FileDiffMetadata } from "@pierre/diffs"
import { type JSX, mergeProps } from "solid-js"
import { createDefaultOptions } from "../pierre"

export * from "@opencode-ai/ui/file"

const MAX_EAGER_LINES = 2_000
const MAX_EAGER_BYTES = 256 * 1024

function size(lines: string[]) {
  return lines.reduce((total, line) => total + line.length, 0)
}

// Inline transcript diffs are hunk-bounded, so Pierre can render them once and
// keep the same instance while the tool streams. Only extreme files fall back
// to Pierre's line virtualizer, which resets on every update.
function virtualize(diff: FileDiffMetadata | undefined) {
  if (!diff) return true
  if (diff.additionLines.length + diff.deletionLines.length > MAX_EAGER_LINES) return true
  return size(diff.additionLines) > MAX_EAGER_BYTES || size(diff.deletionLines) > MAX_EAGER_BYTES
}

// Keep inline file diffs on the same Pierre defaults as the dedicated diff
// viewer: gutter bars, word-level highlighting, and Kilo surface colors.
export function File<T>(props: FileProps<T>) {
  const View = Base as unknown as (props: FileProps<T>) => JSX.Element
  if (props.mode === "text") return <View {...props} />

  const merged = mergeProps(
    () => createDefaultOptions<T>(props.diffStyle),
    () => ({ virtualize: virtualize(props.fileDiff) }),
    props,
  ) as FileProps<T>

  return <View {...merged} />
}
