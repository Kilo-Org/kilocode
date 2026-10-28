// kilocode_change start — the previous implementation used a createEffect that
// ran clearTimeout + setTimeout on every `active` prop change to gate a
// `data-run` attribute. During LLM token streaming in long sessions, tool
// state thrash fired this effect thousands of times per second (CPU profile
// showed ~16% of blocked main-thread time in timer operations). The
// animation is now driven entirely by the `data-active` attribute via CSS —
// no JS timer, no per-change work.
import { createMemo, Show, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"

export const TextShimmer = <T extends ValidComponent = "span">(props: {
  text: string
  class?: string
  as?: T
  active?: boolean
  offset?: number
}) => {
  const text = createMemo(() => props.text ?? "")
  const active = createMemo(() => props.active ?? true)
  const offset = createMemo(() => props.offset ?? 0)
  // Preserve the fade-out structure after live animation, but avoid creating it
  // for historical labels that mount inactive and never shimmer.
  const shimmer = createMemo<boolean>((seen) => seen || active(), false)
  const swap = 220

  return (
    <Dynamic
      component={props.as ?? "span"}
      data-component="text-shimmer"
      data-active={active() ? "true" : "false"}
      class={props.class}
      aria-label={text()}
      style={{
        "--text-shimmer-swap": `${swap}ms`,
        "--text-shimmer-index": `${offset()}`,
      }}
    >
      <Show when={shimmer()} fallback={text()}>
        <span data-slot="text-shimmer-char">
          <span data-slot="text-shimmer-char-base" aria-hidden="true">
            {text()}
          </span>
          <span data-slot="text-shimmer-char-shimmer" aria-hidden="true">
            {text()}
          </span>
        </span>
      </Show>
    </Dynamic>
  )
}
// kilocode_change end
