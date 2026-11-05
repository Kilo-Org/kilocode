/**
 * VS Code adapter implementing the Host interface.
 *
 * This file is on the architecture test allowlist — it is one of the few
 * agent-manager files permitted to import "vscode".
 */

import * as vscode from "vscode"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Host, PanelContext, OutputHandle, Disposable } from "./host"
import type { PRMergeMethod } from "./types"
import { repoName, validateCloneUrl } from "./project/clone"
import { checkoutRoot, samePath } from "./project/paths"
import { integratedBrowserEnabled } from "../services/browser-automation/chrome-setting"
import { keybindings, watchKeybindings } from "../kilo-provider/shortcut-context"
import { createPanel } from "./panel"
import type { Manager } from "../server"

const PR_MERGE_METHODS_KEY = "agentManager.prMergeMethod"
const PROJECTS_KEY = "agentManager.projects"
const NAMESPACE = "kilo-code.v2.agentManager"

export class VscodeHost implements Host {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: { server: Manager; directory: string },
  ) {}

  openPanel(opts: {
    onBeforeMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  }): PanelContext {
    return createPanel({
      context: this.context,
      server: this.panel.server,
      directory: this.panel.directory,
    }).open((message) => {
      void opts.onBeforeMessage(message)
    })
  }

  workspacePath(): string | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!folder) return undefined
    // Worktrees and Agent Manager state belong to the checkout, also when the open folder is a subfolder of it.
    return checkoutRoot(folder) ?? folder
  }

  dirtyFiles(): string[] {
    return vscode.workspace.textDocuments
      .filter((doc) => doc.isDirty && doc.uri.scheme === "file")
      .map((doc) => doc.uri.fsPath)
  }

  async pickFolder(opts?: { defaultPath?: string; title?: string }): Promise<string | undefined> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: vscode.l10n.t("Select Folder"),
      title: opts?.title ?? vscode.l10n.t("Add Project to Agent Manager"),
      defaultUri: opts?.defaultPath ? vscode.Uri.file(opts.defaultPath) : undefined,
    })
    return uris?.at(0)?.fsPath
  }

  async input(opts: Parameters<Host["input"]>[0]): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: opts.title,
      prompt: opts.prompt,
      value: opts.value,
      validateInput: opts.validate,
      ignoreFocusOut: true,
    })
  }

  async confirm(message: string, action: string): Promise<boolean> {
    return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action
  }

  private async git() {
    if (!vscode.workspace.isTrusted) {
      throw new Error(vscode.l10n.t("Trust this workspace before cloning a repository."))
    }
    const version = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(vscode.version)
    if (!version || !(Number(version.at(1)) > 1 || (Number(version.at(1)) === 1 && Number(version.at(2)) >= 111))) {
      throw new Error(
        vscode.l10n.t("Update VS Code to 1.111 or later to clone here. You can still use Open local folder."),
      )
    }
    const extension = vscode.extensions.getExtension<{
      enabled: boolean
      getAPI(version: number): { openRepository(uri: vscode.Uri): Thenable<{ rootUri: vscode.Uri } | null> }
    }>("vscode.git")
    if (!extension || !vscode.workspace.getConfiguration("git").get("enabled", true)) {
      throw new Error(vscode.l10n.t("Enable the built-in Git extension and git.enabled to clone a repository."))
    }
    const git = extension.isActive ? extension.exports : await extension.activate()
    if (!extension.isActive || !git.enabled || !(await vscode.commands.getCommands(true)).includes("git.clone")) {
      throw new Error(
        vscode.l10n.t("The Git clone command is unavailable. Enable the built-in Git extension and reload VS Code."),
      )
    }
    return git.getAPI(1)
  }

  private async existingCheckout(name: string | undefined, selected: string): Promise<string | undefined> {
    if (!name) return undefined
    const dir = path.join(selected, name)
    if (!(await fs.stat(path.join(dir, ".git")).catch(() => undefined))) return undefined
    return dir
  }

  private async directory(dir: string, message: string): Promise<string> {
    const real = await fs.realpath(dir).catch(() => undefined)
    if (!real || !(await fs.stat(real).catch(() => undefined))?.isDirectory()) throw new Error(message)
    return real
  }

  async cloneRepository(url: string, parent: string): Promise<string | undefined> {
    const invalid = validateCloneUrl(url)
    if (invalid) throw new Error(vscode.l10n.t(invalid))
    const git = await this.git()
    const selected = await this.directory(parent, vscode.l10n.t("Select a parent folder for the cloned repository."))
    // Opening an existing checkout beats failing a clone into an occupied folder.
    const name = repoName(url)
    const existing = await this.existingCheckout(name, selected)
    if (existing) {
      const open = await this.confirm(
        vscode.l10n.t("A checkout already exists at {0}. Open it instead of cloning again?", existing),
        vscode.l10n.t("Open existing checkout"),
      )
      return open ? existing : undefined
    }
    let result: string | undefined
    let failure: unknown
    try {
      result = await vscode.commands.executeCommand<string | undefined>("git.clone", url, parent, {
        postCloneAction: "none",
        returnRepositoryPath: true,
      })
    } catch (err) {
      failure = err
    }
    if (result === undefined && failure !== undefined) {
      // A clone can complete while checkout fails, for example a missing Git LFS object.
      const recovered = await this.existingCheckout(name, selected)
      if (!recovered) throw failure
      const attach = await this.confirm(
        vscode.l10n.t("Checkout failed, but the repository was cloned. Attach {0} anyway?", recovered),
        vscode.l10n.t("Attach repository"),
      )
      if (!attach) return undefined
      result = recovered
    }
    if (result === undefined) return undefined
    const message = vscode.l10n.t(
      "Git did not return a repository folder. Use Open local folder to attach the checkout.",
    )
    if (!path.isAbsolute(result)) throw new Error(message)
    const root = await this.directory(result, message)
    const repo = await Promise.resolve(git.openRepository(vscode.Uri.file(root))).catch(() => undefined)
    const canonical = repo && (await fs.realpath(repo.rootUri.fsPath).catch(() => undefined))
    if (!canonical || !samePath(canonical, root)) {
      throw new Error(vscode.l10n.t("The folder returned by Git is not a repository: {0}", root))
    }
    if (
      !samePath(path.dirname(root), selected) &&
      !(await this.confirm(
        vscode.l10n.t("Git returned an existing checkout outside the selected parent folder: {0}", root),
        vscode.l10n.t("Attach existing project at {0}", root),
      ))
    )
      return undefined
    return root
  }

  worktreePool(): boolean {
    return vscode.workspace.getConfiguration(NAMESPACE).get("worktreePool", true)
  }

  onDidChangeWorktreePool(cb: (enabled: boolean) => void): Disposable {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${NAMESPACE}.worktreePool`)) cb(this.worktreePool())
    })
  }

  readProjects(): unknown {
    return this.context.globalState.get(PROJECTS_KEY)
  }

  async writeProjects(value: unknown): Promise<void> {
    await this.context.globalState.update(PROJECTS_KEY, value)
  }

  getPRMergeMethod(repo: string): PRMergeMethod | undefined {
    const values = this.context.globalState.get<Record<string, unknown>>(PR_MERGE_METHODS_KEY)
    const value = values?.[repo]
    if (value === "merge" || value === "squash" || value === "rebase") return value
    return undefined
  }

  async savePRMergeMethod(repo: string, method: PRMergeMethod): Promise<void> {
    const values = this.context.globalState.get<Record<string, unknown>>(PR_MERGE_METHODS_KEY) ?? {}
    await this.context.globalState.update(PR_MERGE_METHODS_KEY, { ...values, [repo]: method })
  }

  unregisterProjectRoutes(): void {}

  onDidChangeWorkspaceFolders(cb: () => void): Disposable {
    return vscode.workspace.onDidChangeWorkspaceFolders(() => cb())
  }

  isTrusted(): boolean {
    return vscode.workspace.isTrusted
  }

  browserAutomation(): boolean {
    return integratedBrowserEnabled() && vscode.workspace.isTrusted
  }

  async approveBrowserNavigation(origin: string): Promise<boolean> {
    if (!vscode.workspace.isTrusted) return false
    const allow = vscode.l10n.t("Allow")
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t("Allow the Integrated Browser to navigate to {origin}?", { origin }),
      { modal: true },
      allow,
    )
    return answer === allow
  }

  autoBranchNaming(): { enabled: boolean; prefix: string } {
    const config = vscode.workspace.getConfiguration(NAMESPACE)
    return {
      enabled: config.get("autoBranchNaming", true),
      prefix: config.get("branchPrefix", ""),
    }
  }

  showError(msg: string): void {
    void vscode.window.showErrorMessage(msg)
  }

  notify(kind: "info" | "warning" | "error", msg: string): void {
    if (kind === "info") void vscode.window.showInformationMessage(msg)
    else if (kind === "warning") void vscode.window.showWarningMessage(msg)
    else void vscode.window.showErrorMessage(msg)
  }

  revealInOS(target: string): void {
    if (vscode.env.remoteName) return
    void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(target))
  }

  async withProgress<T>(title: string, task: (cancelled: () => boolean) => Promise<T>): Promise<T> {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (_progress, token) => task(() => token.isCancellationRequested),
    )
  }

  async openDocument(target: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(target)
    await vscode.window.showTextDocument(doc)
  }

  openFile(target: string, line?: number, column?: number): void {
    void vscode.workspace.openTextDocument(target).then((document) => {
      const position = new vscode.Position(Math.max(0, (line ?? 1) - 1), Math.max(0, (column ?? 1) - 1))
      return vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Active,
        selection: new vscode.Range(position, position),
      })
    })
  }

  openFolder(target: string, newWindow: boolean): void {
    void vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(target), newWindow)
  }

  createOutput(name: string): OutputHandle {
    const channel = vscode.window.createOutputChannel(name)
    return {
      appendLine: (msg) => channel.appendLine(msg),
      show: () => channel.show(true),
      dispose: () => channel.dispose(),
    }
  }

  extensionKeybindings(): Array<{ command: string; key?: string; mac?: string; when?: string }> {
    return keybindings(this.context)
  }

  onDidChangeKeybindings(cb: () => void): Disposable {
    return watchKeybindings(this.context, cb)
  }

  async copyToClipboard(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text)
  }

  async readClipboard(): Promise<string> {
    return vscode.env.clipboard.readText()
  }

  openExternal(url: string): void {
    if (!URL.canParse(url) || !/^https?:$/u.test(new URL(url).protocol)) return
    void vscode.env.openExternal(vscode.Uri.parse(url))
  }

  openSettings(tab?: string, projectId?: string): void {
    void vscode.commands.executeCommand("kilo-code.v2.settings", { tab, projectId })
  }

  refreshGit(): void {
    void vscode.commands.executeCommand("git.refresh")
  }

  dispose(): void {}
}