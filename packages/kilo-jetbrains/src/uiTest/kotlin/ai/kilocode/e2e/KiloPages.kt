package ai.kilocode.e2e

import com.intellij.driver.client.Driver
import com.intellij.driver.model.OnDispatcher
import com.intellij.driver.sdk.Project
import com.intellij.driver.sdk.ui.components.common.ideFrame
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

    fun awaitAny(name: String, vararg classes: String) {
        watchdog.await(name) { classes.any(::shows) }
    }

    fun snapshot(name: String, window: ToolWindow? = null) {
        val component = window?.getComponent()
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
