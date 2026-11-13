import { Component, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"
import Switch from "./Switch"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import { useV2 } from "../../v2/client"
import { CleanupPoll, type CleanupState } from "./cleanup"
import SettingsRow from "./SettingsRow"

const DEFAULT_DAYS = 30

const CheckpointsTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()
  const dialog = useDialog()
  const v2 = useV2()

  const write = (path: string[], value: unknown) => config.set(path, value, config.source(path) ?? "global")

  // The server owns the policy, the pass and its progress; this tab writes the two settings and shows the state.
  const location = { directory: v2.directory }
  const rpc = v2.api.rpc(KiloRetentionRpc.Definition)
  const [state, setState] = createSignal<CleanupState>({ running: false })
  const poll = new CleanupPoll(
    {
      status: (input, options) => rpc.status(input, { location, signal: options.signal }),
      run: (input) => rpc.run(input, { location }),
      cancel: (input) => rpc.cancel(input, { location }),
    },
    setState,
  )
  onMount(() => poll.start())
  onCleanup(() => poll.dispose())

  const enabled = () => config.value(["retention", "enabled"]) === true
  const storedDays = () => {
    const value = config.value(["retention", "maxAgeDays"])
    return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_DAYS
  }
  const [draft, setDraft] = createSignal<string>()
  const commitDays = () => {
    const input = draft()?.trim()
    setDraft(undefined)
    if (!input || !/^\d+$/.test(input)) return
    const next = Number(input)
    if (next >= 1 && next !== storedDays()) write(["retention", "maxAgeDays"], next)
  }

  const progress = () => state().status?.progress
  const busy = () => state().running || progress() !== undefined

  const lastText = () => {
    const run = state().status?.last
    if (!run) return language.t("settings.autoCleanup.lastRun.never")
    const text = language.t("settings.autoCleanup.result", {
      date: new Date(run.at).toLocaleString(),
      deleted: String(run.deleted),
      scanned: String(run.scanned),
      failed: String(run.failed),
      active: String(run.skippedActive),
      seconds: String(Math.max(0.1, Math.round(run.durationMs / 100) / 10)),
    })
    return run.cancelled ? `${text} (${language.t("settings.autoCleanup.lastRun.cancelled")})` : text
  }

  const progressText = () => {
    const current = progress()
    if (!current) return language.t("settings.autoCleanup.starting")
    const values = {
      processed: String(current.processed),
      total: String(current.total),
      deleted: String(current.deleted),
      failed: String(current.failed),
    }
    if (current.phase === "scanning") return language.t("settings.autoCleanup.progress.scanning", values)
    if (current.phase === "cancelling") return language.t("settings.autoCleanup.progress.cancelling", values)
    return language.t("settings.autoCleanup.progress.deleting", values)
  }

  const errorText = (error: NonNullable<CleanupState["error"]>) => {
    if (error === "timeout") return language.t("settings.autoCleanup.error.timeout")
    if (error === "status") return language.t("settings.autoCleanup.error.status")
    return language.t("settings.autoCleanup.error.run")
  }

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
                poll.execute()
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
            checked={config.value(["snapshots"]) !== false}
            onChange={(checked) => write(["snapshots"], checked)}
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
          <Switch checked={enabled()} onChange={(checked) => write(["retention", "enabled"], checked)} hideLabel>
            {language.t("settings.autoCleanup.enable.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.autoCleanup.defaultRetention.title")}
          description={language.t("settings.autoCleanup.defaultRetention.description")}
        >
          <TextField
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={draft() ?? String(storedDays())}
            onChange={setDraft}
            onBlur={commitDays}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              commitDays()
            }}
            hideLabel
            label={language.t("settings.autoCleanup.defaultRetention.title")}
          />
        </SettingsRow>
        <SettingsRow title={language.t("settings.autoCleanup.lastRun.title")} description={lastText()} last>
          <>
            <Button variant="secondary" size="normal" disabled={busy() || !enabled()} onClick={confirmRun}>
              <Show when={busy()}>
                <Spinner />
              </Show>
              {language.t("settings.autoCleanup.runNow")}
            </Button>
            <Show when={progress()}>
              <Button
                variant="ghost"
                size="normal"
                disabled={progress()?.phase === "cancelling"}
                onClick={() => poll.stop()}
              >
                {language.t("settings.autoCleanup.stop")}
              </Button>
            </Show>
          </>
        </SettingsRow>
        <div role="status" aria-live="polite" aria-atomic="true">
          <Show when={busy()}>{progressText()}</Show>
          <Show when={state().error}>{(error) => <div>{errorText(error())}</div>}</Show>
        </div>
      </Card>
    </div>
  )
}

export default CheckpointsTab
