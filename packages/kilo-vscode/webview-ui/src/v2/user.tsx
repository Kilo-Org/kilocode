import type { SessionMessageUser } from "@opencode/client"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import type { ToHost } from "../../../src/protocol"
import { imageMime } from "../../../src/shared/image-data-url"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"

export function UserMessage(props: { message: SessionMessageUser; rowKey?: string; onFork?: () => void }) {
  const language = useLanguage()
  const vscode = useVSCode()
  // The host opens decodable data URLs in a VS Code editor tab; any other image keeps the in-page preview.
  const openImage = (uri: string, name: string | undefined) => {
    if (!imageMime(uri)) return false
    vscode.postMessage({ type: "previewImage", dataUrl: uri, filename: name || "image" } satisfies ToHost)
    return true
  }
  return (
    <div class="vscode-session-turn" data-row="user" data-message={props.message.id} data-row-key={props.rowKey}>
      <div class="vscode-session-turn-user">
        <UserMessageDisplay
          message={props.message}
          copyLabel={language.t("ui.message.copyMessage")}
          onFork={props.onFork}
          onOpenImage={openImage}
        />
      </div>
    </div>
  )
}
