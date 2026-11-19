import type { JSX } from "solid-js"

export function SessionTabList(props: {
  count: number
  label: string
  scroll?: { setRef: (el: HTMLDivElement) => void; showLeft: () => boolean; showRight: () => boolean }
  children: JSX.Element
}) {
  return (
    <div class="am-tab-scroll-area">
      <div class={`am-tab-fade am-tab-fade-left ${props.scroll?.showLeft() ? "am-tab-fade-visible" : ""}`} />
      <div class="am-tab-list-wrap">
        <div
          class="am-tab-list"
          ref={(el) => props.scroll?.setRef(el)}
          role="tablist"
          aria-label={props.label}
          style={{ "--tab-count": `${props.count}` } as JSX.CSSProperties}
        >
          {props.children}
        </div>
      </div>
      <div class={`am-tab-fade am-tab-fade-right ${props.scroll?.showRight() ? "am-tab-fade-visible" : ""}`} />
    </div>
  )
}
