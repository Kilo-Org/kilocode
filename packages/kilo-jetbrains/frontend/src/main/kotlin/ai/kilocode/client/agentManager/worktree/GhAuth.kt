package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import org.jetbrains.plugins.terminal.TerminalToolWindowFactory

/**
 * GitHub's own explanation of the API budget, for the banner and the notification that report a spent
 * one. Nothing in the IDE can lift the limit, so pointing at the rules is the only honest action.
 */
internal const val GH_LIMIT_DOCS = "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api"

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
