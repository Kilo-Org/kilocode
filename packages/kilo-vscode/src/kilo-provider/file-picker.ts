import { window } from "vscode"
import type { ToWebview } from "../protocol"

type Input = {
  requestId: string
  post: (message: ToWebview) => void
}

/** The Browse files entry of the `@` menu: a native file dialog for a file outside the workspace. */
export async function handleFilePicker(input: Input): Promise<void> {
  const uri = await window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Select file",
  })
  input.post({
    type: "filePickerResult",
    path: uri && uri[0] ? uri[0].fsPath : "",
    requestId: input.requestId,
  })
}
