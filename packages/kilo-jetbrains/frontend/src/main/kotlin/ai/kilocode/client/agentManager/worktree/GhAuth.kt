package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import org.jetbrains.plugins.terminal.TerminalToolWindowFactory

@RequiresEdt
internal fun runGhAuthLogin(project: Project) {
    val tab = TerminalToolWindowTabsManager.getInstance(project)
        .createTabBuilder()
        .workingDirectory(project.basePath)
        .tabName("gh auth login")
        .requestFocus(true)
        .createTab()
    ToolWindowManager.getInstance(project)
        .getToolWindow(TerminalToolWindowFactory.TOOL_WINDOW_ID)
        ?.activate(null)
    tab.view.createSendTextBuilder()
        .shouldExecute()
        .send("gh auth login")
    Telemetry.send("Gh Auth Login Opened", mapOf("surface" to "worktree_gh_banner"))
}
