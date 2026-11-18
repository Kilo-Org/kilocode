import type { SessionRevert } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { Icon } from "@kilocode/kilo-ui/icon"
import { type Component, For, Show } from "solid-js"
import type { ToHost } from "../../../../src/protocol"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"

function workspaceNoticeKey(workspace: NonNullable<SessionRevert["workspace"]>) {
  if (workspace === "snapshots-disabled") return "revert.banner.workspace.snapshotsDisabled"
  if (workspace === "not-a-git-repo") return "revert.banner.workspace.notAGitRepo"
  return "revert.banner.workspace.unavailable"
}

export const RevertBanner: Component<{
  revert: SessionRevert
  count: number
  busy?: boolean
  onRedo: () => void
  onRedoAll: () => void
}> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const workspace = () => props.revert.workspace
  const files = () => props.revert.files ?? []

  return (
    <div class="revert-banner" data-component="revert-banner">
      <div class="revert-banner-header">
        <div class="revert-banner-info">
          <Icon name="arrow-left" size="small" />
          <span class="revert-banner-count">
            {props.count === 1
              ? language.t("revert.banner.count_one", { count: props.count })
              : language.t("revert.banner.count_other", { count: props.count })}
          </span>
        </div>
        <div class="revert-banner-actions">
          <Button variant="ghost" size="small" disabled={props.busy} onClick={props.onRedo}>
            {language.t("revert.banner.redo")}
          </Button>
          <Show when={props.count > 1}>
            <Button variant="ghost" size="small" disabled={props.busy} onClick={props.onRedoAll}>
              {language.t("revert.banner.redo.all")}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={files().length > 0}>
        <div class="revert-banner-files">
          <For each={files()}>
            {(file) => (
              <div class="revert-banner-file">
                <span class="revert-banner-filename">{file.file}</span>
                <DiffChanges changes={file} />
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={workspace() && workspace() !== "restored" ? workspace() : undefined}>
        {(reason) => (
          <div class="revert-banner-notice" role="status">
            <span>{language.t(workspaceNoticeKey(reason()))}</span>
            <Show when={reason() === "snapshots-disabled"}>
              <Button
                variant="ghost"
                size="small"
                onClick={() => vscode.postMessage({ type: "openSettingsTab", tab: "checkpoints" } satisfies ToHost)}
              >
                {language.t("revert.banner.workspace.enableSnapshots")}
              </Button>
            </Show>
          </div>
        )}
      </Show>
      <Show when={!workspace()}>
        <div class="revert-banner-notice" role="status">
          <span>{language.t("revert.banner.workspace.legacy")}</span>
        </div>
      </Show>
      <div class="revert-banner-hint">{language.t("revert.banner.hint")}</div>
    </div>
  )
}
