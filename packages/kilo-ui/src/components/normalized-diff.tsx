import { Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileDiffInfo } from "@opencode/client"
import { useFileComponent } from "../context/file"
import { normalize } from "./session-diff"

type DiffInput = FileDiffInfo | { file: string; before: string; after: string; additions: number; deletions: number }

export function NormalizedDiff(props: {
  diff: DiffInput
  requireHunks?: boolean
  before?: JSX.Element
  wrapperComponent?: string
}) {
  const component = useFileComponent()
  const view = () => {
    const value = normalize(props.diff)
    if (props.requireHunks && !value.fileDiff.hunks.length) return undefined
    return value
  }
  return (
    <Show when={view()}>
      {(value) => (
        <Show
          when={props.wrapperComponent}
          fallback={<Dynamic component={component} mode="diff" hunkSeparators="simple" fileDiff={value().fileDiff} />}
        >
          <div data-component={props.wrapperComponent}>
            {props.before}
            <Dynamic component={component} mode="diff" hunkSeparators="simple" fileDiff={value().fileDiff} />
          </div>
        </Show>
      )}
    </Show>
  )
}
