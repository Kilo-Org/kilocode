import { For, createMemo, type Component, type JSX } from "solid-js"
import { useLanguage } from "../../context/language"
import { useLocalTabs } from "../../context/local-tabs"
import { useSession } from "../../context/session"
import { isPendingTab } from "../../utils/local-tabs"
import { useTabScroll } from "../../utils/tab-scroll"
import { SessionTab } from "./SessionTab"

export const SessionTabStrip: Component = () => {
  const tabs = useLocalTabs()
  const session = useSession()
  const language = useLanguage()
  if (!tabs) return null

  const items = createMemo(() => new Map(session.sessions().map((item) => [item.id, item])))
  const title = (id: string) => {
    if (isPendingTab(id)) return language.t("sidebar.session.newSession")
    return items().get(id)?.title || language.t("session.untitled")
  }
  const working = (id: string) => {
    const status = session.allStatusMap()[id]
    return status?.type === "busy" || status?.type === "retry"
  }
  const middle = (id: string, event: MouseEvent) => {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
    tabs.close(id)
  }
  const focus = (root: Element | null, id: string) => {
    requestAnimationFrame(() => {
      const el = root?.querySelector(`[data-tab-id="${id}"] .am-tab`)
      if (el instanceof HTMLElement) el.focus()
    })
  }
  const key = (id: string, event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      tabs.select(id)
      return
    }
    const ids = tabs.ids()
    const index = ids.indexOf(id)
    const next = (() => {
      if (event.key === "ArrowLeft") return ids[(index - 1 + ids.length) % ids.length]
      if (event.key === "ArrowRight") return ids[(index + 1) % ids.length]
      if (event.key === "Home") return ids[0]
      if (event.key === "End") return ids[ids.length - 1]
      return undefined
    })()
    if (!next) return
    event.preventDefault()
    tabs.select(next)
    const root = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest(".am-tab-list") : null
    focus(root, next)
  }
  const scroll = useTabScroll(tabs.ids, tabs.active)

  return (
    <div data-component="session-tabs" class="am-tab-bar session-tab-bar">
      <div class="am-tab-scroll-area">
        <div class={`am-tab-fade am-tab-fade-left ${scroll.showLeft() ? "am-tab-fade-visible" : ""}`} />
        <div class="am-tab-list-wrap">
          <div
            class="am-tab-list"
            ref={scroll.setRef}
            role="tablist"
            style={{ "--tab-count": `${tabs.ids().length}` } as JSX.CSSProperties}
          >
            <For each={tabs.ids()}>
              {(id) => (
                <div class="am-tab-sortable" data-tab-id={id}>
                  <SessionTab
                    title={title(id)}
                    active={tabs.active() === id}
                    busy={working(id)}
                    closeTitle={language.t("common.closeTab")}
                    closeLabel={language.t("common.closeTab")}
                    role="tab"
                    selected={tabs.active() === id}
                    tabIndex={tabs.active() === id ? 0 : -1}
                    onSelect={() => tabs.select(id)}
                    onMiddleClick={(event) => middle(id, event)}
                    onKeyDown={(event) => key(id, event)}
                    onClose={() => tabs.close(id)}
                  />
                </div>
              )}
            </For>
          </div>
        </div>
        <div class={`am-tab-fade am-tab-fade-right ${scroll.showRight() ? "am-tab-fade-visible" : ""}`} />
      </div>
    </div>
  )
}
