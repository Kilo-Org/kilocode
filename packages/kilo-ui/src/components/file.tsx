import { File as Base, type FileProps } from "@opencode-ai/ui/file"
import { type JSX, mergeProps } from "solid-js"
import { createDefaultOptions, virtualize } from "../pierre"

export * from "@opencode-ai/ui/file"

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
