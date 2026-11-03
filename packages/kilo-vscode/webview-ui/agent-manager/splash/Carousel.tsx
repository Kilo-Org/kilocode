import { For, type Accessor } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../src/context/language"
import { navigate, start, wrap } from "./carousel-logic"
import { examples } from "./examples"

/** Wide-layout example picker: a three-card window with arrows and dots, plus the selected pitch. */
export function Carousel(props: { selected: Accessor<number>; onSelect: (index: number) => void }) {
  const { t } = useLanguage()
  let track!: HTMLDivElement
  const move = (delta: number) => props.onSelect(wrap(props.selected(), delta, examples.length))
  const key = (event: KeyboardEvent, index: number) => {
    const next = navigate(event.key, index, examples.length, getComputedStyle(track).direction === "rtl")
    if (next === undefined) return
    event.preventDefault()
    props.onSelect(next)
    ;(track.children.item(next) as HTMLElement | null)?.focus()
  }
  return (
    <div class="am-splash-carousel-view">
      <div class="am-splash-picker">
        <div class="am-splash-carousel">
          <IconButton
            icon="chevron-left"
            variant="ghost"
            class="am-splash-arrow"
            label={t("agentManager.splash.carousel.previous")}
            onClick={() => move(-1)}
          />
          <div
            ref={track}
            class="am-splash-cards"
            style={{ "--am-splash-start": start(props.selected(), examples.length) }}
          >
            <For each={examples}>
              {(example, index) => (
                <Button
                  variant="ghost"
                  class="am-splash-card"
                  classList={{ "am-splash-card-selected": index() === props.selected() }}
                  data-tone={example.id}
                  aria-current={index() === props.selected() ? "true" : undefined}
                  tabIndex={index() === props.selected() ? 0 : -1}
                  onClick={() => props.onSelect(index())}
                  onKeyDown={(event: KeyboardEvent) => key(event, index())}
                >
                  <span class="am-splash-card-tag">{t(example.tag)}</span>
                  <span class="am-splash-card-title">{t(example.title)}</span>
                </Button>
              )}
            </For>
          </div>
          <IconButton
            icon="chevron-right"
            variant="ghost"
            class="am-splash-arrow"
            label={t("agentManager.splash.carousel.next")}
            onClick={() => move(1)}
          />
        </div>
        <div class="am-splash-dots">
          <For each={examples}>
            {(example, index) => (
              <Button
                variant="ghost"
                class="am-splash-dot"
                classList={{ "am-splash-dot-selected": index() === props.selected() }}
                aria-current={index() === props.selected() ? "true" : undefined}
                aria-label={t("agentManager.splash.carousel.goTo", { title: t(example.title) })}
                onClick={() => props.onSelect(index())}
              >
                <span class="am-splash-dot-mark" />
              </Button>
            )}
          </For>
        </div>
      </div>
      <div class="am-splash-example">
        <For each={examples}>
          {(example, index) => (
            <div
              class="am-splash-example-panel"
              classList={{ "am-splash-example-panel-active": index() === props.selected() }}
              aria-hidden={index() !== props.selected() ? "true" : undefined}
            >
              <p class="am-splash-pitch">{t(example.pitch)}</p>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
