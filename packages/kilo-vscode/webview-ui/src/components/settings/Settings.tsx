// Main's Settings view on native v2 data (v2/settings.tsx). The rail and the contents come from SETTINGS_TABS_V2; only
// the tabs marked ready render. Search indexes the i18n rows of the ready tabs, so a result always has a row to reveal.
// The header opens the target config files. Writes go straight through `useSettingsConfig`, so there is no save step.
import { Component, createSignal, createEffect, createMemo, on, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ToHost } from "../../../../src/protocol"
import type { SettingsData } from "../../v2/settings"
import { useSettingsConfig, type SettingsScope } from "../../v2/settings-config"
import SettingsSearch from "./SettingsSearch"
import SettingsSearchResults from "./SettingsSearchResults"
import { SETTINGS_ENTRIES, SETTINGS_TABS, type SettingsEntry, type SettingsTab } from "./settings-search"
import { SETTINGS_TABS_V2 } from "./tabs"
import { useSettingsSearch } from "./useSettingsSearch"

export interface SettingsProps {
  settings: SettingsData
  tab?: string
  onTabChange?: (tab: string) => void
  /** Opens the Profile view, where the Kilo Gateway sign-in runs. */
  onLogin: () => void
}

const READY_TABS = SETTINGS_TABS_V2.filter((tab) => tab.ready)
const READY_IDS = new Set(READY_TABS.map((tab) => tab.id))

const Settings: Component<SettingsProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const config = useSettingsConfig()
  const [active, setActive] = createSignal(props.tab ?? READY_TABS[0]?.id ?? "providers")

  // Sync when the parent changes the tab prop (e.g. via navigate message)
  createEffect(
    on(
      () => props.tab,
      (tab) => {
        if (tab) setActive(tab)
      },
    ),
  )

  const onTabChange = (tab: string) => {
    setActive(tab)
    props.onTabChange?.(tab)
  }

  const open = (scope: SettingsScope) => {
    const path = config.path(scope)
    if (!path) return
    vscode.postMessage({ type: "openFile", path } satisfies ToHost as never)
  }

  // Search covers the ready tabs only, so every result opens a tab that renders.
  const searchTabs = createMemo<SettingsTab[]>(() => SETTINGS_TABS.filter((tab) => READY_IDS.has(tab.id)))
  const searchEntries = createMemo<SettingsEntry[]>(() => SETTINGS_ENTRIES.filter((entry) => READY_IDS.has(entry.tab)))

  const search = useSettingsSearch({
    tabs: searchTabs,
    entries: searchEntries,
    translate: (key) => language.t(key),
    onSelectTab: onTabChange,
  })

  return (
    <div
      data-searching={search.searching() ? "true" : undefined}
      style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": 0 }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": "1px solid var(--border-weak-base)",
          display: "flex",
          "align-items": "center",
          "flex-wrap": "wrap",
          gap: "8px",
        }}
      >
        <h2 style={{ "font-size": "var(--kilo-font-size-16)", "font-weight": "600", margin: 0, flex: 1 }}>
          {language.t("sidebar.settings")}
        </h2>
        <Button variant="secondary" size="small" icon="edit" onClick={() => open("project")}>
          {language.t("settings.openLocalConfig")}
        </Button>
        <Button variant="secondary" size="small" icon="edit" onClick={() => open("global")}>
          {language.t("settings.openGlobalConfig")}
        </Button>
      </div>

      {/* Settings tabs */}
      <Tabs
        orientation="vertical"
        variant="settings"
        value={active()}
        onChange={(tab) => {
          if (search.searching()) search.clear()
          onTabChange(tab)
        }}
        style={{ flex: 1, overflow: "hidden" }}
      >
        <Tabs.List>
          <div data-slot="settings-search-slot">
            <SettingsSearch
              query={search.query()}
              focusRequest={search.focusTick()}
              listId={search.listId}
              activeId={search.activeId()}
              onInput={search.input}
              onClear={search.clear}
              onMove={search.move}
              onChoose={search.choose}
              onDismiss={search.clear}
            />
          </div>
          {READY_TABS.map((tab) => (
            <Tabs.Trigger value={tab.id} aria-label={language.t(tab.title)}>
              <Icon name={tab.icon} />
              <span class="label">{language.t(tab.title)}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {READY_TABS.map((tab) => {
          const Content = tab.component
          return (
            <Tabs.Content value={tab.id}>
              <h3>{language.t(tab.title)}</h3>
              <Content settings={props.settings} onLogin={props.onLogin} />
            </Tabs.Content>
          )
        })}

        <Show when={search.searching()}>
          <SettingsSearchResults
            query={search.query()}
            results={search.results()}
            active={search.active()}
            listId={search.listId}
            tabs={searchTabs()}
            onHover={search.setActive}
            onSelect={search.select}
          />
        </Show>
      </Tabs>
    </div>
  )
}

export default Settings
