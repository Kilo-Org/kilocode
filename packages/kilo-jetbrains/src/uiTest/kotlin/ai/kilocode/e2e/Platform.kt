package ai.kilocode.e2e

import com.intellij.driver.client.Remote
import com.intellij.driver.model.RdTarget
import com.intellij.driver.sdk.Project
import com.intellij.driver.sdk.ui.remote.Component

const val KILO_PLUGIN_ID = "ai.kilocode.jetbrains"
const val KILO_FRONTEND_MODULE = "$KILO_PLUGIN_ID/kilo.jetbrains.frontend"
const val KILO_BACKEND_MODULE = "$KILO_PLUGIN_ID/kilo.jetbrains.backend"
const val KILO_TOOL_WINDOW_ID = "Kilo Code"
const val KILO_CLOUD_PROVIDER_ID = "kilo-cloud"

@Remote("com.intellij.openapi.application.ApplicationManager")
interface ApplicationManager {
    fun getApplication(): Application
}

@Remote("com.intellij.openapi.application.Application")
interface Application {
    fun isDispatchThread(): Boolean
}

@Remote("com.intellij.util.EnvironmentUtil")
interface Environment {
    fun getValue(name: String): String?
}

@Remote("com.intellij.openapi.wm.ToolWindowManager")
interface ToolWindowManager {
    fun getInstance(project: Project): ToolWindowManager
    fun getToolWindow(id: String): ToolWindow?
}

@Remote("com.intellij.openapi.wm.ToolWindow")
interface ToolWindow {
    fun getId(): String
    fun isVisible(): Boolean
    fun show()
    fun getComponent(): Component
    fun getContentManager(): ContentManager
}

@Remote("com.intellij.ui.content.ContentManager")
interface ContentManager {
    fun getContents(): Array<Content>
    fun getSelectedContent(): Content?
    fun setSelectedContent(content: Content, requestFocus: Boolean)
}

@Remote("com.intellij.ui.content.Content")
interface Content {
    fun getDisplayName(): String
    fun getComponent(): Component
}

@Remote("ai.kilocode.client.app.KiloAppService", plugin = KILO_FRONTEND_MODULE)
interface FrontendAppService {
    fun getVersion(): String?
    fun getBundled(): Boolean?
}

@Remote(
    "ai.kilocode.backend.app.KiloBackendAppService",
    plugin = KILO_BACKEND_MODULE,
    rdTarget = RdTarget.BACKEND,
)
interface BackendAppService {
    fun getPort(): Int
}

@Remote("ai.kilocode.backend.cli.KiloProps", plugin = KILO_BACKEND_MODULE, rdTarget = RdTarget.BACKEND)
interface CliProps {
    fun pinned(): Boolean
    fun cliVersion(): String?
}

@Remote("ai.kilocode.client.session.ui.prompt.PromptPanel", plugin = KILO_FRONTEND_MODULE)
interface PromptPanel {
    fun setText(value: String)
    fun send()
    fun isSendEnabled(): Boolean
}

@Remote("ai.kilocode.client.session.ui.SessionMessageListPanel", plugin = KILO_FRONTEND_MODULE)
interface SessionMessageListPanel {
    fun turnCount(): Int
    fun dump(): String
    fun dumpDetailed(): String
    fun messageText(role: String): String
    fun messageErrors(): String
    fun stateName(): String
    fun stateMessage(): String?
    fun sessionId(): String?
}

@Remote("ai.kilocode.client.ui.active.ActiveItem", plugin = KILO_FRONTEND_MODULE)
interface ActiveItem {
    val key: String
    val tooltip: String?
}

@Remote("ai.kilocode.client.ui.tree.ActiveTree", plugin = KILO_FRONTEND_MODULE)
interface ActiveTree {
    fun select(key: String, scroll: Boolean): Boolean
    fun selected(): ActiveItem?
}

@Remote("ai.kilocode.client.agentManager.WorkspaceSessionEditorPanel", plugin = KILO_FRONTEND_MODULE)
interface WorkspaceSessionEditorPanel {
    @Suppress("FunctionName")
    fun `getList$frontend`(): ActiveList
}

@Remote("ai.kilocode.client.ui.tree.ActiveTreeView", plugin = KILO_FRONTEND_MODULE)
interface ActiveTreeView {
    @Suppress("FunctionName")
    fun `open$frontend`(item: ActiveItem, focus: Boolean)
}

@Remote("ai.kilocode.client.ui.list.ActiveList", plugin = KILO_FRONTEND_MODULE)
interface ActiveList {
    fun select(key: String, scroll: Boolean): Boolean
    fun selected(): ActiveItem?
    fun focusList()
}
