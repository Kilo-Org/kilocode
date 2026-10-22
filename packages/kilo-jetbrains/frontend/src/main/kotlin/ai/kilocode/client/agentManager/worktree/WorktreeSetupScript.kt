package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.SetupScriptKind
import ai.kilocode.rpc.dto.SetupScriptTargetDto
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import org.jetbrains.plugins.terminal.TerminalToolWindowFactory

/** Tags a terminal tab as the dedicated setup-script runner for a worktree, keyed by its directory. */
private val SETUP_DIR = Key.create<String>("kilo.worktree.setup.dir")

/**
 * Runs the worktree setup [script] in a terminal tab dedicated to [worktree], distinct from the tab
 * the Terminal button opens. Reusing a separate tab means auto-run on worktree creation never types
 * into (or steals focus from) a shell the user is actively working in, and env is set once at tab
 * creation via [com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabBuilder.envVariables]
 * so the sent command needs no shell-specific env-prefix syntax.
 */
@RequiresEdt
internal fun runWorktreeSetupScript(project: Project, script: SetupScriptTargetDto, worktree: String, repo: String) {
    val tabs = TerminalToolWindowTabsManager.getInstance(project)
    val existing = tabs.tabs.firstOrNull { FileUtil.pathsEqual(it.content.getUserData(SETUP_DIR), worktree) }
    val tab = existing ?: tabs.createTabBuilder()
        .workingDirectory(worktree)
        .envVariables(mapOf("WORKTREE_PATH" to worktree, "REPO_PATH" to repo))
        .tabName(KiloBundle.message("worktree.setup.terminal.tabName", service<WorktreeNameCache>().title(worktree)))
        .requestFocus(true)
        .createTab()
        .also { it.content.putUserData(SETUP_DIR, worktree) }
    if (existing != null) {
        existing.content.manager?.setSelectedContent(existing.content, true)
    }
    ToolWindowManager.getInstance(project).getToolWindow(TerminalToolWindowFactory.TOOL_WINDOW_ID)?.activate(null)
    tab.view.createSendTextBuilder().shouldExecute().send(setupScriptCommand(script))
}

/**
 * Builds the shell command that invokes [script] through its interpreter. Env comes entirely from the
 * tab's [com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabBuilder.envVariables], so this
 * carries no env-var prefix -- only the script path needs quoting, and its syntax is known exactly
 * because [script]'s kind determines which interpreter (and therefore which quoting rules) apply.
 */
internal fun setupScriptCommand(script: SetupScriptTargetDto): String = when (script.kind) {
    SetupScriptKind.POSIX -> "sh ${quotePosix(script.path)}"
    SetupScriptKind.POWERSHELL -> "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ${quoteWindows(script.path)}"
    SetupScriptKind.CMD -> "cmd.exe /d /s /c ${quoteWindows(script.path)}"
}

/** Single-quotes [path] for POSIX shells, escaping embedded single quotes the standard `'\''` way. */
private fun quotePosix(path: String): String = "'" + path.replace("'", "'\\''") + "'"

/** Double-quotes [path] for PowerShell/cmd, doubling embedded double quotes. */
private fun quoteWindows(path: String): String = "\"" + path.replace("\"", "\"\"") + "\""
