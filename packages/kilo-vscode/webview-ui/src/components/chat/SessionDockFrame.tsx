import type { JSX } from "solid-js"

export function SessionDockFrame(props: { active: boolean; ref?: (el: HTMLDivElement) => void; children: JSX.Element }) {
  return <div class="session-dock" ref={props.ref} data-component="session-dock" data-active={props.active ? "" : undefined}>{props.children}</div>
}
