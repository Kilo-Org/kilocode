package ai.kilocode.client

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionSidePanelManager
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.agentManager.applySidePanelMode
import ai.kilocode.client.agentManager.worktree.WorktreeController
import ai.kilocode.client.agentManager.AgentManagerPanel
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.log.KiloLog
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.platform.project.projectIdOrNull
import com.intellij.openapi.wm.impl.content.ToolWindowContentUi
import com.intellij.ui.content.Content
import com.intellij.ui.content.ContentManagerEvent
import com.intellij.ui.content.ContentManagerListener
import com.intellij.ui.content.ContentFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.ComponentOrientation
import javax.swing.JPanel

/**
 * Creates the Kilo Code tool window and delegates session content management.
 *
 * Resolves the project directory through the backend (handles split-mode
 * where `project.basePath` is a synthetic frontend path) before creating
 * the workspace. The tool window shows a loading state until resolution
 * completes.
 */
class KiloToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        project.service<KiloToolWindowSetupService>().create(toolWindow)
    }
}

private val LOG = KiloLog.create(KiloToolWindowFactory::class.java)

@Service(Service.Level.PROJECT)
internal class KiloToolWindowSetupService(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    fun create(toolWindow: ToolWindow) {
        val start = System.currentTimeMillis()
        try {
            val workspaces = service<KiloWorkspaceService>()
            val hint = project.basePath ?: ""
            // Experimental IntelliJ ProjectId API keeps multi-window and split-mode routing exact.
            val pid = project.projectIdOrNull()

            cs.launch {
                val dir = workspaces.resolveProjectDirectory(pid, hint)
                val workspace = workspaces.workspace(dir)
                withContext(Dispatchers.Main) {
                    setup(project, toolWindow, workspace)
                }
                Telemetry.send("Tool Window Opened", mapOf(
                    "projectResolved" to dir.isNotBlank().toString(),
                    "durationMs" to (System.currentTimeMillis() - start).toString(),
                ))
            }
        } catch (e: Exception) {
            Telemetry.send("Tool Window Setup Failed", mapOf("stage" to "create", "errorClass" to e::class.java.name))
            LOG.error("Failed to create Kilo tool window content", e)
        }
    }

    private fun setup(
        project: Project,
        toolWindow: ToolWindow,
        workspace: Workspace,
    ) {
        try {
            val manager = SessionSidePanelManager(project, workspace)

            val worktrees = WorktreeController(
                service<KiloWorktreeService>(),
                workspace.directory,
                cs,
                activity = project.service<KiloSessionService>().activity,
            )
            val agentManagerPanel = AgentManagerPanel(manager, worktrees, project)

            val chat = object : JPanel(BorderLayout()), DataProvider {
                override fun getData(dataId: String): Any? {
                    if (SessionManager.KEY.`is`(dataId)) return manager
                    if (SessionManager.WORKSPACE_KEY.`is`(dataId)) return workspace
                    if (SidePanelKeys.MODE.`is`(dataId)) return SidePanelMode.CHAT
                    return null
                }
            }
            chat.add(manager.component, BorderLayout.CENTER)
            val agent = object : JPanel(BorderLayout()), DataProvider {
                override fun getData(dataId: String): Any? {
                    // Expose the shared manager here too so History works from the Agent Manager tab.
                    if (SessionManager.KEY.`is`(dataId)) return manager
                    if (SessionManager.WORKSPACE_KEY.`is`(dataId)) return workspace
                    if (SidePanelKeys.MODE.`is`(dataId)) return SidePanelMode.AGENT_MANAGER
                    if (SidePanelKeys.WORKTREE_PANEL.`is`(dataId)) return agentManagerPanel
                    return null
                }
            }
            agent.add(agentManagerPanel.component, BorderLayout.CENTER)

            // Hide the "Kilo Code" id label in the header so only the content tabs remain.
            toolWindow.component.putClientProperty(ToolWindowContentUi.HIDE_ID_LABEL, "true")

            val factory = ContentFactory.getInstance()
            val chatContent = factory.createContent(chat, KiloBundle.message("sidePanel.mode.branch"), false)
            chatContent.applySidePanelMode(SidePanelMode.CHAT)
            chatContent.setDisposer(manager)
            chatContent.setPreferredFocusedComponent { manager.defaultFocusedComponent }
            val agentContent = factory.createContent(agent, KiloBundle.message("sidePanel.mode.agentManager"), false)
            agentContent.applySidePanelMode(SidePanelMode.AGENT_MANAGER)
            agentContent.applyAgentManagerBetaBadge()
            agentContent.setPreferredFocusedComponent { agentManagerPanel.component }
            toolWindow.contentManager.addContent(chatContent)
            toolWindow.contentManager.addContent(agentContent)
            val listener = object : ContentManagerListener {
                override fun selectionChanged(event: ContentManagerEvent) {
                    if (event.operation == ContentManagerEvent.ContentOperation.add && event.content === agentContent) {
                        agentManagerPanel.refresh()
                    }
                }
            }
            toolWindow.contentManager.addContentManagerListener(listener)
            Disposer.register(manager) { toolWindow.contentManager.removeContentManagerListener(listener) }
            toolWindow.contentManager.setSelectedContent(chatContent)
            manager.newSession()

            val actions = listOfNotNull(
                ActionManager.getInstance().getAction("Kilo.NewSession"),
                ActionManager.getInstance().getAction("Kilo.NewWorktree"),
                ActionManager.getInstance().getAction("Kilo.History"),
            )
            toolWindow.setTitleActions(actions)
            // Settings moves off the toolbar into the header gear (options) menu: Open Settings…,
            // Config Files, and Core, inlined from the declarative Kilo.SettingsGroup.
            (ActionManager.getInstance().getAction("Kilo.SettingsGroup") as? ActionGroup)?.let {
                toolWindow.setAdditionalGearActions(it)
            }
        } catch (e: Exception) {
            Telemetry.send("Tool Window Setup Failed", mapOf("stage" to "setup", "errorClass" to e::class.java.name))
            LOG.error("Failed to set up Kilo tool window content", e)
        }
    }
}

internal fun Content.applyAgentManagerBetaBadge() {
    icon = AllIcons.General.Beta
    description = KiloBundle.message("sidePanel.mode.agentManager.beta.description")
    putUserData(ToolWindow.SHOW_CONTENT_ICON, true)
    // TAB_LABEL_ORIENTATION_KEY is @ApiStatus.Experimental and may change or disappear between IDE
    // releases; we declare no untilBuild cap. Failure is benign: putUserData no-ops and the Beta
    // icon falls back to the left of the tab label.
    putUserData(Content.TAB_LABEL_ORIENTATION_KEY, ComponentOrientation.RIGHT_TO_LEFT)
}
