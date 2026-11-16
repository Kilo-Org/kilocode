// The open worktree's folder was deleted on disk while its branch survived. Its sessions cannot run until the folder is
// back, so the chat offers the same restore as the worktree card's hover card.

/** @jsxImportSource solid-js */

import { Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../src/context/language"
import type { WorktreeState } from "../src/types/messages/agent-manager"
import type { WorktreeHealthState } from "./project/store"

export const MissingWorktreeBanner: Component<{
  worktree?: WorktreeState
  health?: WorktreeHealthState
  onRestore: (worktreeId: string) => void
}> = (props) => {
  const { t } = useLanguage()
  return (
    <Show when={props.health === "absent-restorable" ? props.worktree : undefined} keyed>
      {(worktree) => (
        <div class="am-readonly-banner" role="alert" data-component="missing-worktree">
          <Icon name="warning" size="small" />
          <span class="am-readonly-text">
            {t("agentManager.worktree.health.absent-restorableNote", { branch: worktree.branch })}
          </span>
          <Button variant="primary" size="small" onClick={() => props.onRestore(worktree.id)}>
            {t("agentManager.worktree.restore")}
          </Button>
        </div>
      )}
    </Show>
  )
}
