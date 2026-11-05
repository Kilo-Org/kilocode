package ai.kilocode.e2e

import com.intellij.driver.client.Driver
import com.intellij.driver.model.OnDispatcher
import com.intellij.driver.sdk.Project
import com.intellij.driver.sdk.ui.components.UiComponent
import com.intellij.driver.sdk.ui.components.common.ideFrame
import com.intellij.driver.sdk.ui.remote.Component
import com.intellij.driver.sdk.ui.remote.SwingHierarchyService
import com.intellij.driver.sdk.ui.ui
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * Small page-object layer over the real IntelliJ component tree and public services.
 * No production hook: every locator is an existing Swing class or public service.
 */
class KiloIdePage(val driver: Driver, val watchdog: Watchdog, val evidence: DriverEvidence) {
    private val ui = driver.ui

    fun project(): Project = watchdog.value("project frame loaded") { driver.ideFrame().project }

    fun isDispatchThread(): Boolean = driver.withContext(OnDispatcher.EDT) {
        driver.utility(ApplicationManager::class).getApplication().isDispatchThread()
    }

    fun environment(): Environment = driver.utility(Environment::class)

    fun frontend(): FrontendAppService = driver.service(FrontendAppService::class)

    fun backend(): BackendAppService = driver.service(BackendAppService::class)

    fun cli(): CliProps = driver.utility(CliProps::class)

    fun shows(javaClass: String): Boolean =
        ui.searchService.findAll("//div[@javaclass='$javaClass']").any {
            runCatching { it.isShowing() }.getOrDefault(false)
        }

    fun components(javaClass: String): List<UiComponent> =
        runCatching { ui.xx("//div[@javaclass='$javaClass']").list() }.getOrDefault(emptyList())

    fun showing(javaClass: String): UiComponent? =
        components(javaClass).firstOrNull {
            runCatching { it.component.isShowing() }.getOrDefault(false)
        }

    fun showingIn(root: UiComponent, javaClass: String): UiComponent? = runCatching {
        root.xx("//div[@javaclass='$javaClass']").list().firstOrNull {
            runCatching { it.component.isShowing() }.getOrDefault(false)
        }
    }.getOrNull()

    fun awaitAny(name: String, vararg classes: String) {
        watchdog.await(name) { classes.any(::shows) }
    }

    fun snapshot(name: String, window: ToolWindow? = null) {
        snapshotComponent(name, window?.getComponent())
    }

    fun snapshotComponent(name: String, component: Component?) {
        val xml = driver.service(SwingHierarchyService::class).getSwingHierarchyAsDOM(component, false)
        val file = evidence.artifactsDir.resolve("snapshots").resolve("$name.xml")
        Files.createDirectories(file.parent)
        Files.writeString(file, evidence.redact(xml))
        evidence.artifact("snapshot", file)
        evidence.log("wrote component snapshot $name")
    }

    fun screenshot(name: String) {
        val dir = evidence.artifactsDir.resolve("screenshots")
        Files.createDirectories(dir)
        val produced = driver.takeScreenshot(dir.toString()) ?: run {
            evidence.log("screenshot $name was not produced")
            return
        }
        val source = Path.of(produced)
        val extension = source.fileName.toString().substringAfterLast('.', "png")
        val target = dir.resolve("$name.$extension")
        runCatching { Files.move(source, target, StandardCopyOption.REPLACE_EXISTING) }
        evidence.artifact("screenshot", target)
        evidence.log("wrote screenshot $name")
    }
}

class KiloToolWindowPage(private val driver: Driver, private val watchdog: Watchdog) {
    fun open(project: Project): ToolWindow {
        val manager = driver.utility(ToolWindowManager::class).getInstance(project)
        val window = watchdog.value("Kilo tool window registered") {
            manager.getToolWindow(KILO_TOOL_WINDOW_ID)
        }
        if (!window.isVisible()) {
            driver.withContext(OnDispatcher.EDT) { window.show() }
        }
        watchdog.await("Kilo tool window visible") { window.isVisible() }
        return window
    }

    fun select(window: ToolWindow, tab: String) {
        val manager = window.getContentManager()
        val content = watchdog.value("$tab tab present") {
            manager.getContents().firstOrNull { it.getDisplayName() == tab }
        }
        driver.withContext(OnDispatcher.EDT) { manager.setSelectedContent(content, true) }
        watchdog.await("$tab tab selected") { manager.getSelectedContent()?.getDisplayName() == tab }
    }

    fun selected(window: ToolWindow): String? = window.getContentManager().getSelectedContent()?.getDisplayName()

    fun selectedVisible(window: ToolWindow): Boolean =
        window.getContentManager().getSelectedContent()?.getComponent()?.isShowing() == true
}

class AgentManagerPage(private val ide: KiloIdePage, private val watchdog: Watchdog) {
    fun awaitVisible() = ide.awaitAny("Agent Manager panel visible", AGENT_MANAGER_PANEL)

    fun text(): String = texts(ide, AGENT_MANAGER_PANEL)

    companion object {
        const val AGENT_MANAGER_PANEL = "ai.kilocode.client.agentManager.AgentManagerPanel"
    }
}

class TranscriptPage(private val ide: KiloIdePage, private val watchdog: Watchdog) {
    fun awaitVisible(window: KiloToolWindowPage? = null, ref: ToolWindow? = null) {
        watchdog.await("Kilo chat content visible") {
            ROOTS.any(ide::shows) || (window != null && ref != null && window.selectedVisible(ref))
        }
    }

    fun text(): String = ROOTS.firstOrNull(ide::shows)?.let { texts(ide, it) } ?: ""

    fun hasText(fragment: String): Boolean = text().contains(fragment)

    companion object {
        private val ROOTS = arrayOf(
            "ai.kilocode.client.session.ui.SessionMessageListPanel",
            "ai.kilocode.client.session.ui.SessionRootPanel",
            "ai.kilocode.client.session.ui.prompt.PromptPanel",
            "ai.kilocode.client.session.history.HistoryPanel",
        )
    }
}

class PromptPage(private val ide: KiloIdePage, private val watchdog: Watchdog) {
    fun awaitVisible() = ide.awaitAny("prompt panel visible", PROMPT_PANEL)

    fun isVisible(): Boolean = ide.shows(PROMPT_PANEL)

    fun text(): String = texts(ide, PROMPT_PANEL)

    companion object {
        const val PROMPT_PANEL = "ai.kilocode.client.session.ui.prompt.PromptPanel"
    }
}

class PermissionPage(private val ide: KiloIdePage, private val watchdog: Watchdog) {
    fun awaitVisible() = ide.awaitAny("permission card visible", PERMISSION_VIEW)

    fun isVisible(): Boolean = ide.shows(PERMISSION_VIEW)

    fun text(): String = texts(ide, PERMISSION_VIEW)

    companion object {
        const val PERMISSION_VIEW = "ai.kilocode.client.session.views.permission.PermissionView"
    }
}

private fun texts(ide: KiloIdePage, javaClass: String): String {
    if (!ide.shows(javaClass)) return ""
    return runCatching {
        ide.driver.ui.x("//div[@javaclass='$javaClass']")
            .getAllTexts()
            .joinToString("\n") { it.text }
    }.getOrDefault("")
}

data class TranscriptState(
    val text: String,
    val accessibleNames: List<String>,
    val turns: Int,
    val dump: String,
    val detailed: String,
)

data class PromptState(
    val text: String,
    val accessibleNames: List<String>,
    val turns: Int,
    val dump: String,
    val detailed: String,
    val user: String,
    val assistant: String,
    val errors: String,
    val state: String,
    val message: String?,
    val session: String?,
)

data class HostedRowState(
    val key: String,
    val selectedKey: String,
    val tooltip: String,
)

/**
 * `session.open` / `prompt.stream` page object for both lanes. It only uses the real prompt,
 * transcript, and Agent Manager components plus the loaded transcript model's public helpers.
 */
class SessionOpenPage(private val ide: KiloIdePage, private val watchdog: Watchdog) {
    fun submitLocal(token: String) = submit(token)

    fun submit(text: String, scope: UiComponent? = null) {
        val component = watchdog.value("Chat prompt panel visible") {
            if (scope == null) ide.showing(PROMPT_PANEL) else ide.showingIn(scope, PROMPT_PANEL)
        }
        val panel = ide.driver.cast(component.component, PromptPanel::class)
        ide.driver.withContext(OnDispatcher.EDT) { panel.setText(text) }
        try {
            watchdog.await("Chat prompt accepts the submitted text") {
                ide.driver.withContext(OnDispatcher.EDT) { panel.isSendEnabled() }
            }
        } catch (error: Throwable) {
            ide.driver.withContext(OnDispatcher.EDT) { panel.setText("") }
            throw error
        }
        ide.driver.withContext(OnDispatcher.EDT) { panel.send() }
    }

    fun awaitModel(scope: UiComponent? = null): TranscriptState =
        watchdog.value("transcript model loaded") { readModel(scope) }

    fun awaitLoaded(scope: UiComponent? = null): PromptState =
        watchdog.value("transcript model loaded") { readPrompt(scope)?.takeIf(::loaded) }

    fun awaitRender(token: String, scope: UiComponent? = null): TranscriptState =
        watchdog.value("transcript renders '$token'") { readRender(token, scope) }

    fun awaitStreaming(token: String, scope: UiComponent? = null): PromptState =
        watchdog.value("turn busy while the fake-LLM gate holds '$token'") {
            readPrompt(scope)?.takeIf { it.state == "Busy" && occurrences(it, token) >= 1 }
        }

    /** Waits for the turn to leave Busy, including a terminal failure, so callers can report it. */
    fun awaitSettled(scope: UiComponent? = null): PromptState =
        watchdog.value("turn settled after the fake-LLM gate release") {
            readPrompt(scope)?.takeIf { it.state in settled }
        }

    fun hostedEditor(): UiComponent? = ide.showing(HOSTED_EDITOR)

    fun transcriptComponent(scope: UiComponent? = null): Component? =
        (if (scope == null) ide.showing(SESSION_MESSAGE_LIST) else ide.showingIn(scope, SESSION_MESSAGE_LIST))?.component

    /** Rendered occurrences of [token], taking the stronger of component text and accessible names. */
    fun occurrences(state: PromptState, token: String): Int {
        if (token.isEmpty()) return 0
        val text = state.text.split(token).size - 1
        val names = state.accessibleNames.joinToString("\n").split(token).size - 1
        return maxOf(text, names)
    }

    fun discoverHosted(workspaceId: String): HostedRowState {
        val key = hostedKey(workspaceId)
        val treeComponent = watchdog.value("Agent Manager tree visible") {
            ide.showing(ACTIVE_TREE)
        }
        val tree = ide.driver.cast(treeComponent.component, ActiveTree::class)
        watchdog.await("hosted workspace row '$key' discovered from the raw origin") {
            ide.driver.withContext(OnDispatcher.EDT) { tree.select(key, false) }
        }
        val item = watchdog.value("hosted workspace row selected") {
            ide.driver.withContext(OnDispatcher.EDT) { tree.selected() }
        }
        val selectedKey = runCatching { item.key }.getOrDefault("")
        val tooltip = runCatching { item.tooltip }.getOrNull().orEmpty()
        val view = ide.driver.cast(
            (ide.showing(ACTIVE_TREE_VIEW) ?: treeComponent).component,
            ActiveTreeView::class,
        )
        ide.driver.withContext(OnDispatcher.EDT) { view.`open$frontend`(item, true) }
        watchdog.await("hosted workspace editor opened") { ide.shows(HOSTED_EDITOR) }
        return HostedRowState(key, selectedKey, tooltip)
    }

    fun awaitHostedSession(workspaceId: String, nativeSessionId: String): String {
        val expected = "${hostedKey(workspaceId)}:$nativeSessionId"
        val panel = watchdog.value("hosted workspace editor visible") {
            ide.showing(HOSTED_EDITOR)
        }
        runCatching { ide.snapshotComponent("hosted-workspace-editor", panel.component) }
        val ref = runCatching {
            ide.driver.cast(panel.component, WorkspaceSessionEditorPanel::class)
        }.getOrNull()
        val list = watchdog.value("hosted root session list visible") {
            val own = ref?.let { runCatching { it.`getList$frontend`() }.getOrNull() }
            own ?: showingHostedList(expected)
        }
        val selected = ide.driver.withContext(OnDispatcher.EDT) { list.selected()?.key }
        if (selected != expected) {
            ide.driver.withContext(OnDispatcher.EDT) { list.select(expected, false) }
            ide.driver.withContext(OnDispatcher.EDT) { list.focusList() }
            ide.driver.ui.keyboard { enter() }
        }
        watchdog.await("hosted root session '$expected' selected") {
            ide.driver.withContext(OnDispatcher.EDT) { list.selected()?.key } == expected
        }
        return expected
    }

    fun hostedEditorVisible(): Boolean = ide.shows(HOSTED_EDITOR)

    fun hostedSelection(): String? {
        val panel = ide.showing(HOSTED_EDITOR) ?: return null
        val ref = runCatching {
            ide.driver.cast(panel.component, WorkspaceSessionEditorPanel::class)
        }.getOrNull()
        val list = ref?.let { runCatching { it.`getList$frontend`() }.getOrNull() }
        if (list != null) {
            val key = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { list.selected()?.key }
            }.getOrNull()
            if (key != null && key.startsWith("hosted:")) return key
        }
        for (component in ide.components(ACTIVE_LIST)) {
            if (!runCatching { component.component.isShowing() }.getOrDefault(false)) continue
            val candidate = runCatching {
                ide.driver.cast(component.component, ActiveList::class)
            }.getOrNull() ?: continue
            val key = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { candidate.selected()?.key }
            }.getOrNull()?.takeIf { it.startsWith("hosted:") } ?: continue
            return key
        }
        return null
    }

    private fun readModel(scope: UiComponent? = null): TranscriptState? {
        val state = readState(scope) ?: return null
        if (state.turns <= 0 || state.dump.isBlank()) return null
        if (!state.dump.contains("user#")) return null
        if (!state.detailed.contains("PromptView#")) return null
        return state
    }

    private fun readRender(token: String, scope: UiComponent? = null): TranscriptState? {
        val state = readState(scope) ?: return null
        val visible = state.text.contains(token) || state.accessibleNames.any { it.contains(token) }
        return state.takeIf { visible }
    }

    private fun readState(scope: UiComponent? = null): TranscriptState? {
        val component = showingTranscript(scope) ?: return null
        val panel = runCatching {
            ide.driver.cast(component.component, SessionMessageListPanel::class)
        }.getOrNull() ?: return null
        return TranscriptState(
            text = componentText(component),
            accessibleNames = accessibleNames(component),
            turns = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.turnCount() }
            }.getOrDefault(0),
            dump = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.dump() }
            }.getOrDefault(""),
            detailed = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.dumpDetailed() }
            }.getOrDefault(""),
        )
    }

    private fun readPrompt(scope: UiComponent? = null): PromptState? {
        val component = showingTranscript(scope) ?: return null
        val panel = runCatching {
            ide.driver.cast(component.component, SessionMessageListPanel::class)
        }.getOrNull() ?: return null
        return PromptState(
            text = componentText(component),
            accessibleNames = accessibleNames(component),
            turns = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.turnCount() }
            }.getOrDefault(0),
            dump = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.dump() }
            }.getOrDefault(""),
            detailed = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.dumpDetailed() }
            }.getOrDefault(""),
            user = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.messageText("user") }
            }.getOrDefault(""),
            assistant = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.messageText("assistant") }
            }.getOrDefault(""),
            errors = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.messageErrors() }
            }.getOrDefault(""),
            state = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.stateName() }
            }.getOrDefault("Unknown"),
            message = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.stateMessage() }
            }.getOrNull(),
            session = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { panel.sessionId() }
            }.getOrNull(),
        )
    }

    private fun loaded(state: PromptState): Boolean =
        state.turns > 0 && state.dump.contains("user#") && state.detailed.contains("PromptView#")

    private fun showingTranscript(scope: UiComponent?): UiComponent? =
        if (scope == null) ide.showing(SESSION_MESSAGE_LIST) else ide.showingIn(scope, SESSION_MESSAGE_LIST)

    private fun componentText(component: UiComponent): String =
        runCatching { component.getAllTexts().joinToString("\n") { it.text } }.getOrDefault("")

    private fun accessibleNames(component: UiComponent): List<String> = runCatching {
        component.searchContext.findAll("//div[@accessiblename]").mapNotNull {
            runCatching { it.getAccessibleContext()?.getAccessibleName() }.getOrNull()
                ?.takeIf(String::isNotBlank)
        }
    }.getOrDefault(emptyList())

    private fun showingHostedList(expected: String): ActiveList? {
        for (component in ide.components(ACTIVE_LIST)) {
            if (!runCatching { component.component.isShowing() }.getOrDefault(false)) continue
            val list = runCatching {
                ide.driver.cast(component.component, ActiveList::class)
            }.getOrNull() ?: continue
            val selected = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { list.selected()?.key }
            }.getOrNull()
            if (selected == expected) return list
            val picked = runCatching {
                ide.driver.withContext(OnDispatcher.EDT) { list.select(expected, false) }
            }.getOrDefault(false)
            if (picked) return list
        }
        return null
    }

    private fun hostedKey(workspaceId: String): String = "hosted:$KILO_CLOUD_PROVIDER_ID:$workspaceId"

    companion object {
        const val SESSION_MESSAGE_LIST = "ai.kilocode.client.session.ui.SessionMessageListPanel"
        const val PROMPT_PANEL = "ai.kilocode.client.session.ui.prompt.PromptPanel"
        const val ACTIVE_TREE = "ai.kilocode.client.ui.tree.ActiveTree"
        const val ACTIVE_TREE_VIEW = "ai.kilocode.client.ui.tree.ActiveTreeView"
        const val ACTIVE_LIST = "ai.kilocode.client.ui.list.ActiveList"
        const val HOSTED_EDITOR = "ai.kilocode.client.agentManager.hosted.HostedWorkspaceEditorPanel"
        val settled = setOf("Idle", "Error", "TurnEnded", "LoginRequired")
    }
}
