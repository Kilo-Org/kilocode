import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { For, Show, createMemo, createSignal, type Component, type JSX } from "solid-js"
import { useLanguage } from "../../context/language"
import { useLocalTabs } from "../../context/local-tabs"
import { useSession } from "../../context/session"
import { isPendingTab } from "../../utils/local-tabs"
import { useTabScroll } from "../../utils/tab-scroll"
import { focusPrompt, focusSelectedTab, focusTabElement, handleTabKey } from "../../utils/tab-navigation"
import { setTabWidths } from "../../utils/tab-widths"
import { useVSCode } from "../../context/vscode"
import { useConfig } from "../../context/config"
import { SessionTab } from "./SessionTab"
import { SessionTabMenu } from "./SessionTabMenu"
import { SessionTabSwitcher } from "./SessionTabSwitcher"
import { ConstrainDragYAxis, SortableTabContainer } from "./TabDnd"

export const SessionTabStrip: Component = () => {
  const tabs = useLocalTabs()
  const session = useSession()
  const language = useLanguage()
  const vscode = useVSCode()
  const { config } = useConfig()
  const [dragging, setDragging] = createSignal<string>()
  const [announcement, setAnnouncement] = createSignal("")
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
    close(id, false)
  }
  const key = (id: string, event: KeyboardEvent) => {
    const root = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest(".am-tab-list") : null
    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault()
      const ids = tabs.ids()
      const target = tabs.move(id, event.key === "ArrowLeft" ? -1 : 1)
      if (target === undefined) return
      tabs.persist()
      setAnnouncement(`${title(id)} ${target + 1}/${ids.length}`)
      focusTabElement(root, id)
      return
    }
    handleTabKey({ ids: tabs.ids(), id, event, select: tabs.select, root })
  }
  const scroll = useTabScroll(tabs.ids, tabs.active, () => config().experimental?.smooth_scrolling !== false)
  const root = () => document.querySelector("[data-component=session-tabs] .am-tab-list")
  const rows = createMemo(() =>
    tabs.ids().map((id) => ({
      id,
      title: title(id),
      active: tabs.active() === id,
      busy: working(id),
      pending: isPendingTab(id),
    })),
  )
  const freeze = () => setTabWidths(true, document)
  const release = () => setTabWidths(false, document)
  const close = (id: string, restore = true) => {
    freeze()
    const active = tabs.active() === id
    tabs.close(id)
    if (!active && restore) focusSelectedTab(document, focusPrompt)
    requestAnimationFrame(release)
  }
  const closeOthers = (id: string) => {
    freeze()
    tabs.closeOthers(id)
    focusTabElement(document, id, focusPrompt)
    requestAnimationFrame(release)
  }
  const dragStart = (event: DragEvent) => {
    const id = event.draggable?.id
    if (typeof id !== "string") return
    freeze()
    setDragging(id)
  }
  const dragOver = (event: DragEvent) => {
    const from = event.draggable?.id
    const to = event.droppable?.id
    if (typeof from === "string" && typeof to === "string") tabs.reorder(from, to)
  }
  const dragEnd = () => {
    setDragging(undefined)
    release()
    tabs.persist()
  }

  return (
    <DragDropProvider
      collisionDetector={closestCenter}
      onDragStart={dragStart}
      onDragOver={dragOver}
      onDragEnd={dragEnd}
    >
      <DragDropSensors />
      <ConstrainDragYAxis />
      <div
        data-component="session-tabs"
        class="am-tab-bar session-tab-bar"
        onPointerLeave={() => {
          if (!dragging()) release()
        }}
      >
        <div class="am-tab-scroll-area">
          <div class={`am-tab-fade am-tab-fade-left ${scroll.showLeft() ? "am-tab-fade-visible" : ""}`} />
          <div class="am-tab-list-wrap">
            <div
              class="am-tab-list"
              ref={scroll.setRef}
              role="tablist"
              style={{ "--tab-count": `${tabs.ids().length}` } as JSX.CSSProperties}
            >
              <SortableProvider ids={tabs.ids()}>
                <For each={tabs.ids()}>
                  {(id) => (
                    <SortableTabContainer id={id}>
                      <SessionTabMenu
                        showFork
                        onFork={
                          !isPendingTab(id) && !working(id)
                            ? () => vscode.postMessage({ type: "forkSession", sessionId: id })
                            : undefined
                        }
                        onClose={() => close(id)}
                        onCloseOthers={tabs.ids().length > 1 ? () => closeOthers(id) : undefined}
                      >
                        <SessionTab
                          title={title(id)}
                          active={tabs.active() === id}
                          busy={working(id)}
                          closeTitle={language.t("common.closeTab")}
                          closeLabel={language.t("common.closeTab")}
                          role="tab"
                          selected={tabs.active() === id}
                          tabIndex={tabs.active() === id ? 0 : -1}
                          closeTabIndex={tabs.active() === id ? 0 : -1}
                          keyShortcuts="Meta+Shift+ArrowLeft Control+Shift+ArrowLeft Meta+Shift+ArrowRight Control+Shift+ArrowRight"
                          onSelect={() => tabs.select(id)}
                          onMiddleClick={(event) => middle(id, event)}
                          onKeyDown={(event) => key(id, event)}
                          onClose={() => close(id)}
                        />
                      </SessionTabMenu>
                    </SortableTabContainer>
                  )}
                </For>
              </SortableProvider>
            </div>
          </div>
          <div class={`am-tab-fade am-tab-fade-right ${scroll.showRight() ? "am-tab-fade-visible" : ""}`} />
        </div>
        <div class="session-tab-switcher-wrap">
          <SessionTabSwitcher
            items={rows}
            labels={{
              open: language.t("session.tabs.switcher.open"),
              search: language.t("session.tabs.switcher.search"),
              close: language.t("common.closeTab"),
              current: language.t("session.tabs.switcher.current"),
              pending: language.t("session.tabs.switcher.pending"),
              busy: language.t("session.tabs.switcher.busy"),
            }}
            onSelect={tabs.select}
            onRestore={focusPrompt}
            onClose={(id) => close(id, false)}
          />
        </div>
      </div>
      <div class="sr-only" aria-live="polite">
        {announcement()}
      </div>
      <DragOverlay>
        <Show when={dragging()}>{(id) => <div class="session-tab-overlay">{title(id())}</div>}</Show>
      </DragOverlay>
    </DragDropProvider>
  )
}
