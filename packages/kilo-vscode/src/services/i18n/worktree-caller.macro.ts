import path from "node:path"

const ui = path.resolve(import.meta.dir, "../../../webview-ui")
const locales = new Bun.Glob("*.ts").scanSync(path.join(ui, "agent-manager/i18n"))
const entries = await Promise.all(
  Array.from(locales, async (file) => {
    const manager = await import(path.join(ui, "agent-manager/i18n", file))
    const app = await import(path.join(ui, "src/i18n", file))
    return [
      path.basename(file, ".ts"),
      {
        "agentManager.setup.failed": manager.dict["agentManager.setup.failed"],
        "session.workspaceScope.alternatives": app.dict["session.workspaceScope.alternatives"],
        "prompt.action.autoApprove.enabledNotification": app.dict["prompt.action.autoApprove.enabledNotification"],
        "prompt.action.autoApprove.disabledNotification": app.dict["prompt.action.autoApprove.disabledNotification"],
      },
    ]
  }),
)

// Inline only the translations used by native notifications in the host bundle.
export function callerMessages(): Record<string, Record<string, string>> {
  return Object.fromEntries(entries)
}
