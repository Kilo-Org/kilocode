import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { useLanguage } from "../context/language"

export function UserMessage(props: { message: SessionMessageUser; rowKey?: string }) {
  const language = useLanguage()
  return (
    <div class="vscode-session-turn" data-row="user" data-message={props.message.id} data-row-key={props.rowKey}>
      <div class="vscode-session-turn-user">
        <UserMessageDisplay message={props.message} copyLabel={language.t("ui.message.copyMessage")} />
      </div>
    </div>
  )
}
