import { Show, createMemo, createSignal } from "solid-js"
import { Avatar } from "@kilocode/kilo-ui/avatar"
import { githubUrl } from "./pr-comment-payload"

const BOTS = new Set(["kilo-code-bot", "kilocode-bot", "kilo-maintainer", "kiloconnect", "kiloconnect-lite"])

export function PRAvatar(props: { author: string; avatar?: string }) {
  const icons = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const [failed, setFailed] = createSignal<string[]>([])
  const source = createMemo(() => {
    const logo = BOTS.has(props.author.toLowerCase().replace(/\[bot\]$/, "")) ? `${icons}/kilo-light.svg` : undefined
    return [githubUrl(props.avatar), logo].find((src) => src && !failed().includes(src))
  })

  return (
    <Show when={source()} keyed fallback={<Avatar fallback={props.author} size="small" aria-hidden="true" />}>
      {(src) => (
        <Avatar
          src={src}
          fallback={props.author}
          size="small"
          aria-hidden="true"
          ref={(node) => node.addEventListener("error", () => setFailed((prev) => [...prev, src]), true)}
        />
      )}
    </Show>
  )
}
