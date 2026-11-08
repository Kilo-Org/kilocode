import { type Component } from "solid-js"
import { ShortcutKeys } from "../shared/ShortcutKeys"

/**
 * Visual copy of the prompt placeholder that renders the suggested shortcut as
 * keycaps. The textarea keeps the plain placeholder text for screen readers.
 */
export const PromptHint: Component<{ before: string; binding: string; after: string }> = (props) => {
  // Keep brackets next to the keys, so "(" never wraps away from them.
  const open = () => props.before.match(/[\p{Ps}\p{Pi}]*$/u)?.[0] ?? ""
  const close = () => props.after.match(/^[\p{Pe}\p{Pf}\p{Po}]*/u)?.[0] ?? ""
  return (
    <div class="prompt-input-placeholder" aria-hidden="true" dir="auto">
      {props.before.slice(0, props.before.length - open().length)}
      <span class="prompt-input-keys-wrap">
        {open()}
        <ShortcutKeys binding={props.binding} />
        {close()}
      </span>
      {props.after.slice(close().length)}
    </div>
  )
}
