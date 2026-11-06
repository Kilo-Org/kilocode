// The Kilo diff viewer for a tool call. It renders the patch as Pierre hunks in a webview, so the diff reaches the
// editor even when the file is not on disk, and the user can switch between the unified and split layouts.
import { window, Uri, workspace, ViewColumn, env, type Disposable, type Webview, type WebviewPanel } from "vscode"
import { html } from "./chat"
import type { ToolActionDiff } from "./protocol"
import { appendOutput } from "./review-utils"
import { getDiffMarkdownRender, getUserDiffStyle, setDiffMarkdownRender, setUserDiffStyle } from "./review-settings"
import { effectiveFontSize, readKiloSettings } from "./settings-host"

type DiffStyle = "unified" | "split"

/** One file of the virtual viewer. `files` holds several files, as the patch tool shows them. */
export type DiffVirtualFile = {
  file: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  files?: DiffVirtualFile[]
  initialDiffStyle?: DiffStyle
}

const VIEW_TYPE = "kilo-code.v2.DiffVirtualPanel"

/**
 * The tool diff surface of the chat view. It reuses one panel: a new tool diff replaces the shown files instead of
 * opening another editor.
 */
export class DiffVirtualProvider implements Disposable {
  private panel: WebviewPanel | undefined
  private pending: DiffVirtualFile | undefined
  private readonly output = window.createOutputChannel("Kilo Diff Virtual")

  constructor(private readonly extensionUri: Uri) {}

  /** One file's patch. `initialDiffStyle` is a hint; the remembered style wins when the user set one. */
  open(diff: ToolActionDiff, initialDiffStyle?: DiffStyle): void {
    this.show(one(diff), initialDiffStyle)
  }

  /** Several files at once, stacked in one panel. */
  openMany(diffs: ToolActionDiff[], initialDiffStyle?: DiffStyle): void {
    const first = diffs[0]
    if (!first) return
    this.show(
      {
        file: first.file,
        additions: 0,
        deletions: 0,
        files: diffs.map(one),
      },
      initialDiffStyle,
    )
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = undefined
    this.pending = undefined
    this.output.dispose()
  }

  private show(diff: DiffVirtualFile, initialDiffStyle?: DiffStyle): void {
    diff.initialDiffStyle = getUserDiffStyle() ?? (initialDiffStyle === "split" ? "split" : "unified")
    this.pending = diff
    const count = diff.files?.length ?? 1
    const title = count > 1 ? `Changes: ${count} files` : `Changes: ${diff.file.split("/").pop() ?? diff.file}`

    if (this.panel) {
      this.panel.title = title
      this.panel.reveal(ViewColumn.One)
      this.push()
      return
    }

    const panel = window.createWebviewPanel(VIEW_TYPE, title, ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })
    panel.iconPath = {
      light: Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }
    panel.webview.html = this.getHtml(panel.webview)
    panel.webview.onDidReceiveMessage((message: Record<string, unknown>) => this.onMessage(message))
    panel.onDidDispose(() => {
      this.log("Panel disposed")
      this.panel = undefined
      this.pending = undefined
    })
    this.panel = panel
  }

  private onMessage(message: Record<string, unknown>): void {
    if (message.type === "webviewReady") return this.push()
    if (message.type === "diffVirtual.setMarkdownRender" && typeof message.render === "boolean") {
      void setDiffMarkdownRender(message.render)
      return
    }
    if (message.type === "diffVirtual.setDiffStyle" && (message.style === "unified" || message.style === "split")) {
      void setUserDiffStyle(message.style)
    }
  }

  private push(): void {
    if (!this.pending) return
    this.post({
      type: "diffVirtual.data",
      diff: this.pending,
      initialDiffStyle: this.pending.initialDiffStyle,
      markdownRender: getDiffMarkdownRender(),
    })
  }

  private post(message: Record<string, unknown>): void {
    if (this.panel) void this.panel.webview.postMessage(message)
  }

  private getHtml(webview: Webview): string {
    const uri = (...parts: string[]) =>
      webview.asWebviewUri(Uri.joinPath(this.extensionUri, ...parts)).toString()
    return html({
      csp: webview.cspSource,
      script: uri("dist", "diff-virtual.js"),
      style: uri("dist", "diff-virtual.css"),
      icons: uri("assets", "icons"),
      worker: uri("dist", "shiki-worker.js"),
      markdown: uri("dist", "markdown-shiki-worker.js"),
      directory: workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
      size: effectiveFontSize(),
      language: env.language,
      version: "",
      settings: readKiloSettings(),
    })
  }

  private log(...args: unknown[]): void {
    appendOutput(this.output, "DiffVirtual", ...args)
  }
}

function one(diff: ToolActionDiff): DiffVirtualFile {
  return {
    file: diff.file,
    patch: diff.patch,
    additions: diff.additions,
    deletions: diff.deletions,
  }
}
