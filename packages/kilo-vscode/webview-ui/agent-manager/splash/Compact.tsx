import { For, type Accessor } from "solid-js"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { useLanguage } from "../../src/context/language"
import { examples } from "./examples"

/** Example picker below the wide layout: scrolling pill tabs, each with its pitch as the panel. */
export function Compact(props: { selected: Accessor<number>; onSelect: (index: number) => void }) {
  const { t } = useLanguage()
  return (
    <Tabs
      class="am-splash-compact"
      variant="pill"
      value={String(props.selected())}
      onChange={(value) => props.onSelect(Number(value))}
    >
      <Tabs.List class="am-splash-tabs" aria-label={t("agentManager.splash.eyebrow")}>
        <For each={examples}>
          {(example, index) => (
            <Tabs.Trigger value={String(index())} classes={{ button: "am-splash-tab" }} data-tone={example.id}>
              <span class="am-splash-tab-dot" aria-hidden="true" />
              {t(example.tag)}
            </Tabs.Trigger>
          )}
        </For>
      </Tabs.List>
      <div class="am-splash-example">
        <For each={examples}>
          {(example, index) => (
            <Tabs.Content
              value={String(index())}
              forceMount
              class="am-splash-example-panel am-splash-compact-panel"
              classList={{ "am-splash-example-panel-active": index() === props.selected() }}
            >
              <p class="am-splash-pitch">{t(example.pitch)}</p>
            </Tabs.Content>
          )}
        </For>
      </div>
    </Tabs>
  )
}
