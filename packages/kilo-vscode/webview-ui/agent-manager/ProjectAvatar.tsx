/** @jsxImportSource solid-js */

import { createSignal, Show, type Component } from "solid-js"

/**
 * Project thumbnail: the GitHub organization avatar, or the first letter of
 * the project name when the project has no GitHub remote or the image fails.
 */
export const ProjectAvatar: Component<{ label: string; src?: string }> = (props) => {
  const [failed, setFailed] = createSignal<string>()
  const src = () => (props.src && failed() !== props.src ? props.src : undefined)
  const letter = () => (props.label.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase()
  return (
    <Show when={src()} fallback={<span class="am-project-avatar am-project-avatar-letter">{letter()}</span>}>
      {(url) => <img class="am-project-avatar" src={url()} alt="" draggable={false} onError={() => setFailed(url())} />}
    </Show>
  )
}
