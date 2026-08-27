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
import ai.kilocode.client.agentManager.sessionAttentionNeeded
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.AttentionDotIcon
import ai.kilocode.log.KiloLog
import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowContentUiType
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.platform.project.projectIdOrNull
import com.intellij.openapi.wm.impl.content.ToolWindowContentUi
import com.intellij.ui.content.ContentManagerEvent
import com.intellij.ui.content.ContentManagerListener
import com.intellij.ui.content.ContentFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
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
                abort = { id, dir -> project.service<KiloSessionService>().abort(id, dir) },
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

            toolWindow.setContentUiType(ToolWindowContentUiType.TABBED, null)
            // Hide the "Kilo Code" id label in the header so only the content tabs remain.
            toolWindow.component.putClientProperty(ToolWindowContentUi.HIDE_ID_LABEL, "true")

            val factory = ContentFactory.getInstance()
            val chatContent = factory.createContent(chat, KiloBundle.message("sidePanel.mode.branch"), false)
            chatContent.applySidePanelMode(SidePanelMode.CHAT)
            chatContent.setDisposer(manager)
            chatContent.setPreferredFocusedComponent { manager.defaultFocusedComponent }
            val agentContent = factory.createContent(agent, KiloBundle.message("sidePanel.mode.agentManager"), false)
            agentContent.applySidePanelMode(SidePanelMode.AGENT_MANAGER)
            agentContent.setPreferredFocusedComponent { agentManagerPanel.component }
            agentContent.putUserData(ToolWindow.SHOW_CONTENT_ICON, true)
            toolWindow.contentManager.addContent(chatContent)
            toolWindow.contentManager.addContent(agentContent)
            val agents = { toolWindow.contentManager.setSelectedContent(agentContent, true) }
            // The chat branch dock's "New Worktree" action opens the Agent Manager's New Worktree
            // dialog and only switches to that tab once the user confirms. The dialog is anchored on
            // the chat panel because the Agents content may not be in a window hierarchy yet.
            manager.onNewWorktree = {
                Telemetry.send("New Worktree Clicked", mapOf("surface" to "chat_dock"))
                agentManagerPanel.configure(anchor = chat, onCreate = { agents() })
            }
            manager.onMoveToWorktree = { id, dir ->
                agents()
                agentManagerPanel.move(id, dir)
            }
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

            // Notification dot on the Agents tab: up for as long as any worktree session is waiting
            // on the user or has failed. Viewing the tab must not clear it — only resolving the
            // attention does, so the dot stays a reliable "something still needs you" signal.
            val dot = cs.launch {
                project.service<KiloSessionService>().activity.map(::sessionAttentionNeeded).collect { needed ->
                    withContext(Dispatchers.Main) {
                        agentContent.icon = if (needed) AttentionDotIcon else null
                    }
                }
            }
            Disposer.register(manager) { dot.cancel() }

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
