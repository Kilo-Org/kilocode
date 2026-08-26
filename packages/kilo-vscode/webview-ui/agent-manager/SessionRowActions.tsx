/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { LanguageContextValue } from "../src/context/language"

interface Props {
  t: LanguageContextValue["t"]
  /** Move the session into a freshly created worktree. */
  onWorktree: () => void
  /** Move the session back to the project root and open it in the local tabs. */
  onLocal: () => void
}

/** Direct hover actions for sessions in the Agent Manager history view. */
export const SessionRowActions: Component<Props> = (props) => (
  <>
    <Tooltip value={props.t("agentManager.session.openInWorktree")} placement="right">
      <IconButton
        icon="branch"
        size="small"
        variant="ghost"
        aria-label={props.t("agentManager.session.openInWorktree")}
        data-slot="session-row-action"
        onClick={props.onWorktree}
      />
    </Tooltip>
    <Tooltip value={props.t("agentManager.session.openLocally")} placement="right">
      <IconButton
        icon="local"
        size="small"
        variant="ghost"
        aria-label={props.t("agentManager.session.openLocally")}
        data-slot="session-row-action"
        onClick={props.onLocal}
      />
    </Tooltip>
  </>
)
