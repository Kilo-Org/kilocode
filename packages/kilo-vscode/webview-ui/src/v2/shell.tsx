// The chat webview shell: the shared providers plus the rich content the transcript needs (Markdown, code, diffs).
import type { ParentComponent } from "solid-js"
import { RichProvider } from "../context/rich-provider"
import { ShellBase } from "./shell-base"

export const WebviewShell: ParentComponent = (props) => (
  <ShellBase>
    <RichProvider>{props.children}</RichProvider>
  </ShellBase>
)
