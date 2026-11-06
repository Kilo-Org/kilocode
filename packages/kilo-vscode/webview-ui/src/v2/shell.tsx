// The chat webview shell: the shared providers plus the rich content the transcript needs (Markdown, code, diffs).
import type { ParentComponent } from "solid-js"
import { ToolApprovalVisibilityProvider } from "@kilocode/kilo-ui/message-part"
import { RichProvider } from "../context/rich-provider"
import { autoApprovalReasonVisible } from "./kilo-settings"
import { ShellBase } from "./shell-base"

export const WebviewShell: ParentComponent = (props) => (
  <ShellBase>
    <RichProvider>
      <ToolApprovalVisibilityProvider value={autoApprovalReasonVisible}>{props.children}</ToolApprovalVisibilityProvider>
    </RichProvider>
  </ShellBase>
)
