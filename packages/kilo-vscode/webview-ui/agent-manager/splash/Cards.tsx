import { For, type Accessor } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../../src/context/language"
import { examples } from "./examples"

/** Wide-layout example picker: every example is a card, with the selected pitch below. */
export function Cards(props: { selected: Accessor<number>; onSelect: (index: number) => void }) {
  const { t } = useLanguage()
  return (
    <div class="am-splash-wide">
      <div class="am-splash-picker">
        <div class="am-splash-cards" role="group" aria-label={t("agentManager.splash.eyebrow")}>
          <For each={examples}>
            {(example, index) => (
              <Button
                variant="ghost"
                class="am-splash-card"
                classList={{ "am-splash-card-selected": index() === props.selected() }}
                data-tone={example.id}
                aria-current={index() === props.selected() ? "true" : undefined}
                onClick={() => props.onSelect(index())}
              >
                <span class="am-splash-card-tag">{t(example.tag)}</span>
                <span class="am-splash-card-title">{t(example.title)}</span>
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
