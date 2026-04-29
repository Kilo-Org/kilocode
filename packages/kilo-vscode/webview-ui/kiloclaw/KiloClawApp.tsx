// KiloClaw root component

import { Switch, Match } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Toast } from "@kilocode/kilo-ui/toast"
import { ClawProvider, useClaw } from "./context/claw"
import { KiloClawLanguageProvider, useKiloClawLanguage } from "./context/language"
import { ChatPanel } from "./components/ChatPanel"
import { StatusSidebar } from "./components/StatusSidebar"
import { SetupView } from "./components/SetupView"
import { UpgradeView } from "./components/UpgradeView"

function Content() {
  const claw = useClaw()
  const { t } = useKiloClawLanguage()

  return (
    <div class="kiloclaw-root">
      <Switch>
        <Match when={claw.phase() === "loading"}>
          <div class="kiloclaw-center">
            <div class="kiloclaw-loading">
              <Spinner />
              <span>{t("kiloClaw.loading")}</span>
            </div>
          </div>
        </Match>
        <Match when={claw.phase() === "noInstance"}>
          <SetupView />
        </Match>
        <Match when={claw.phase() === "needsUpgrade"}>
          <UpgradeView />
        </Match>
        <Match when={claw.phase() === "error"}>
          <div class="kiloclaw-center">
            <div class="kiloclaw-error-view">
              <span class="kiloclaw-error-text">{claw.error()}</span>
              <Button variant="primary" onClick={() => claw.retry()}>
                {t("kiloClaw.error.retry")}
              </Button>
            </div>
          </div>
        </Match>
        <Match when={claw.phase() === "ready"}>
          <div class="kiloclaw-layout">
            <ChatPanel />
            <StatusSidebar />
          </div>
        </Match>
      </Switch>
      <Toast.Region />
    </div>
  )
}

export function KiloClawApp() {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <ClawProvider>
        <LanguageBridge>
          <MarkedProvider>
            <Content />
          </MarkedProvider>
        </LanguageBridge>
      </ClawProvider>
    </ThemeProvider>
  )
}

/** Bridges the claw context locale into the language provider. Must be below ClawProvider. */
function LanguageBridge(props: { children: any }) {
  const claw = useClaw()
  return <KiloClawLanguageProvider locale={claw.locale}>{props.children}</KiloClawLanguageProvider>
}
