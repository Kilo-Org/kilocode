import path from "node:path"

const ui = path.resolve(import.meta.dir, "../../../webview-ui")
const kilo = path.resolve(import.meta.dir, "../../../../kilo-i18n/src")
const locales = new Bun.Glob("*.ts").scanSync(path.join(ui, "agent-manager/i18n"))
const entries = await Promise.all(
  Array.from(locales, async (file) => {
    const manager = await import(path.join(ui, "agent-manager/i18n", file))
    const app = await import(path.join(ui, "src/i18n", file))
    // `@kilocode/kilo-i18n` has no dictionary for every app locale (no Persian yet); those fall back to English.
    const own: { dict?: Record<string, string> } = await import(path.join(kilo, file)).catch(() => ({}))
    return [
      path.basename(file, ".ts"),
      {
        "agentManager.setup.failed": manager.dict["agentManager.setup.failed"],
        "session.workspaceScope.alternatives": app.dict["session.workspaceScope.alternatives"],
        "prompt.action.autoApprove.enabledNotification": app.dict["prompt.action.autoApprove.enabledNotification"],
        "prompt.action.autoApprove.disabledNotification": app.dict["prompt.action.autoApprove.disabledNotification"],
        ...(own.dict
          ? {
              "browser.notice.extension": own.dict["browser.notice.extension"],
              "browser.notice.switch": own.dict["browser.notice.switch"],
            }
          : {}),
      },
    ]
  }),
)

// Inline only the translations used by native notifications in the host bundle.
export function callerMessages(): Record<string, Record<string, string>> {
  return Object.fromEntries(entries)
}
