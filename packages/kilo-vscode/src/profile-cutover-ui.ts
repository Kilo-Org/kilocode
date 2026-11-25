import { env, ProgressLocation, window, type OutputChannel } from "vscode"
import { prepareProfile, verifyProfile } from "./profile-cutover"
import { activeProfile, useProfile } from "./active-profile"
import { t } from "./services/i18n"
import type { Command } from "./server"

export function profileCutover(cwd: string, output: OutputChannel, environment = process.env) {
  const input = { cwd, env: environment, log: (line: string) => output.append(line) }
  return {
    async activate(command: Command | undefined, settings: Record<string, string>) {
      try {
        const ready = await prepareProfile(
          { ...input, command, settings },
          {
            confirm: async (inventory) => {
              const bytes = new Intl.NumberFormat(env.language, { style: "unit", unit: "byte", unitDisplay: "short" })
              const summary = t("migration.summary", {
                source: inventory.source,
                sourceBytes: bytes.format(inventory.sourceBytes),
                walBytes: bytes.format(inventory.walBytes),
                totalBytes: bytes.format(inventory.sourceBytes + inventory.walBytes),
                availableBytes: bytes.format(inventory.availableBytes),
                backup: inventory.backup,
              })
              const accept = t("migration.accept")
              const choice = await window.showWarningMessage(
                t("migration.title"),
                { modal: true, detail: `${summary}\n\n${t("migration.warning")}` },
                { title: accept, accepted: true },
                { title: t("migration.notNow"), isCloseAffordance: true },
              )
              return choice?.accepted === true
            },
            progress: (run) =>
              window.withProgress(
                { location: ProgressLocation.Notification, title: t("migration.progress"), cancellable: false },
                (progress) =>
                  run(({ phase, done, total }) =>
                    progress.report({
                      message:
                        total !== undefined
                          ? `${phase} · ${done ?? "…"}/${total}`
                          : done !== undefined
                            ? `${phase} · ${done}`
                            : phase,
                    }),
                  ),
              ),
          },
        )
        if (!ready) {
          void window.showInformationMessage(t("migration.stopped"))
          return false
        }
        useProfile(ready.profile)
        return true
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        output.appendLine(detail)
        void window.showErrorMessage(t("migration.stopped"), { modal: true, detail })
        return false
      }
    },
    async beforeStart(command: Command, settings?: Record<string, string>) {
      try {
        useProfile(await verifyProfile({ ...input, command, settings }, activeProfile))
      } catch (error) {
        throw new Error(`${t("migration.stopped")}\n${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
