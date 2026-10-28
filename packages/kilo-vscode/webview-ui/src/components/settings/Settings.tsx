// Main's Settings view on native v2 data (v2/settings.tsx). Only tabs with a v2 contract are here: Providers
// (`api.integration.*`, `api.credential.*`) and About Kilo Code. The other v1 tabs, the Open Config buttons and the
// save bar have no v2 contract yet: `api.config.update` patches only `shell`, and the v2 extension contributes no
// VS Code settings. The Reload button is `api.location.reload`.
import { Component, createSignal, createEffect, createMemo, lazy, on, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../../context/language"
import type { SettingsData } from "../../v2/settings"
import SettingsSearch from "./SettingsSearch"
import SettingsSearchResults from "./SettingsSearchResults"
import { SETTINGS_TABS, type SettingsEntry, type SettingsTab } from "./settings-search"
import { useSettingsSearch } from "./useSettingsSearch"

const ProvidersTab = lazy(() => import("./ProvidersTab"))
const AboutKiloCodeTab = lazy(() => import("./AboutKiloCodeTab"))

/** The v1 tabs that the v2 Settings view renders. */
const TABS = new Set(["providers", "aboutKiloCode"])

export interface SettingsProps {
  settings: SettingsData
  tab?: string
  onTabChange?: (tab: string) => void
  /** Opens the Profile view, where the Kilo Gateway sign-in runs. */
  onLogin: () => void
}

const Settings: Component<SettingsProps> = (props) => {
  const language = useLanguage()
  const [active, setActive] = createSignal(props.tab ?? "providers")

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

  const reload = () => {
    void props.settings.reload().catch((err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    })
  }

  // v2 renders no row that carries a `data-search-label`, so the index holds no rows and search returns the tabs
  // themselves. The v1 rows without a v2 contract must not appear as results that cannot be revealed.
  const searchTabs = createMemo<SettingsTab[]>(() => SETTINGS_TABS.filter((tab) => TABS.has(tab.id)))
  const searchEntries = createMemo<SettingsEntry[]>(() => [])

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
        <Tooltip value={language.t("common.reloadDescription")} placement="bottom">
          <Button variant="secondary" size="small" onClick={reload}>
            <Icon name="reload" size="small" />
            {language.t("common.reload")}
          </Button>
        </Tooltip>
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
          <Tabs.Trigger value="providers" aria-label={language.t("settings.providers.title")}>
            <Icon name="providers" />
            <span class="label">{language.t("settings.providers.title")}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="aboutKiloCode" aria-label={language.t("settings.aboutKiloCode.title")}>
            <Icon name="help" />
            <span class="label">{language.t("settings.aboutKiloCode.title")}</span>
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="providers">
          <h3>{language.t("settings.providers.title")}</h3>
          <ProvidersTab settings={props.settings} onLogin={props.onLogin} />
        </Tabs.Content>
        <Tabs.Content value="aboutKiloCode">
          <h3>{language.t("settings.aboutKiloCode.title")}</h3>
          <AboutKiloCodeTab settings={props.settings} />
        </Tabs.Content>

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
