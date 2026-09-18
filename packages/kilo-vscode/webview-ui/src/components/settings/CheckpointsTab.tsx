import { Component, For, createSignal, onCleanup, onMount } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { AutoCleanupLastResult, ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const DAY_FIELDS = [{ key: "maxAgeDays", name: "defaultRetention", fallback: 30 }] as const

function days(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : fallback
}

const CheckpointsTab: Component = () => {
  const { config, isDirty, updateConfig } = useConfig()
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const [last, setLast] = createSignal<AutoCleanupLastResult | null>(null)
  const [running, setRunning] = createSignal(false)

  onMount(() => {
    vscode.postMessage({ type: "requestAutoCleanupState" })
  })
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "autoCleanupStateLoaded") {
      setLast(message.last)
      setRunning(false)
    }
  })
  onCleanup(unsubscribe)

  const policy = () => config().retention ?? {}
  const enabled = () => Boolean(policy().enabled)
  const lastText = () => {
    const run = last()
    if (!run) return language.t("settings.autoCleanup.lastRun.never")
    return language.t("settings.autoCleanup.result", {
      date: new Date(run.at).toLocaleString(),
      deleted: String(run.deleted),
      scanned: String(run.scanned),
      failed: String(run.failed),
      active: String(run.skippedActive),
      seconds: String(Math.max(0.1, Math.round(run.durationMs / 100) / 10)),
    })
  }

  const updateDays = (key: (typeof DAY_FIELDS)[number]["key"]) => (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    if (!/^\d+$/.test(trimmed)) return
    const next = Number(trimmed)
    if (Number.isInteger(next) && next >= 1) updateConfig({ retention: { ...policy(), [key]: next } })
  }

  const toggle = (checked: boolean) => updateConfig({ retention: { ...policy(), enabled: checked } })

  const confirmRun = () => {
    dialog.show(() => (
      <Dialog title={language.t("settings.autoCleanup.runNow")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("settings.autoCleanup.runNow.confirm")}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                setRunning(true)
                vscode.postMessage({ type: "runAutoCleanupNow" })
              }}
            >
              {language.t("settings.autoCleanup.runNow")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.checkpoints.enable.title")}
          description={language.t("settings.checkpoints.enable.description")}
          last
        >
          <Switch
            checked={config().snapshot !== false}
            onChange={(checked) => updateConfig({ snapshot: checked })}
            hideLabel
          >
            {language.t("settings.checkpoints.enable.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <div style={{ height: "12px" }} />

      <Card>
        <SettingsRow
          title={language.t("settings.autoCleanup.enable.title")}
          description={language.t("settings.autoCleanup.enable.description")}
        >
          <Switch checked={enabled()} onChange={toggle} hideLabel>
            {language.t("settings.autoCleanup.enable.title")}
          </Switch>
        </SettingsRow>
        <For each={DAY_FIELDS}>
          {(field) => (
            <SettingsRow
              title={language.t(`settings.autoCleanup.${field.name}.title`)}
              description={language.t(`settings.autoCleanup.${field.name}.description`)}
            >
              <TextField
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={String(days(policy()[field.key], field.fallback))}
                onChange={updateDays(field.key)}
                hideLabel
                label={language.t(`settings.autoCleanup.${field.name}.title`)}
              />
            </SettingsRow>
          )}
        </For>
        <SettingsRow title={language.t("settings.autoCleanup.lastRun.title")} description={lastText()} last>
          <Button
            variant="secondary"
            size="normal"
            disabled={running() || isDirty() || !enabled()}
            onClick={confirmRun}
          >
            {language.t("settings.autoCleanup.runNow")}
          </Button>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default CheckpointsTab
