package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActions
import ai.kilocode.client.session.SessionActionsKeys
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUiTestBase
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.views.TextView
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.WorktreePrDto
import ai.kilocode.rpc.dto.GhState
import com.intellij.ide.DataManager
import com.intellij.ide.impl.HeadlessDataManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.Toggleable
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAware
import com.intellij.testFramework.replaceService
import ai.kilocode.client.session.model.SessionState
import org.w3c.dom.Document
import org.w3c.dom.Element
import java.awt.Component
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Covers the two session action menus — the right-click context menu and the prompt bar's "more"
 * popup — plus each new action's visibility rules. Most importantly, it covers that the context
 * published by `SessionUi` resolves from a target deep inside the transcript: the reused
 * `Kilo.StopSession` action reads a data key whose local provider is a sibling of the transcript, so
 * without `SessionUi` republishing it the menu would silently render it invisible.
 */
@Suppress("UnstableApiUsage")
class SessionContextMenuActionsTest : SessionUiTestBase() {

    // ---- group shape ----

    fun `test context menu group lists actions in order with separators`() {
        assertEquals(
            listOf(
                "Kilo.Session.AutoApprove",
                "---",
                "Kilo.Session.CompareToBase",
                "Kilo.Session.OpenPr",
                "Kilo.Session.CopyPrRef",
                "---",
                "\$Copy",
                "---",
                "Kilo.Session.CopyId",
                "Kilo.Session.Share",
                "Kilo.Session.CopyShareLink",
                "---",
                "Kilo.StopSession",
            ),
            menuChildren("Kilo.Session.ContextMenu"),
        )
    }

    /**
     * New Worktree / Move to Worktree are deliberately not here — they live only on the branch dock
     * toolbar, which is their own `UiDataProvider` and needs no republishing from `SessionUi`.
     */
    fun `test context menu does not reference worktree actions`() {
        val worktree = menuChildren("Kilo.Session.ContextMenu").filter { it.startsWith("Kilo.Chat.") }

        assertEquals(emptyList<String>(), worktree)
    }

    fun `test prompt menu group lists session actions in order`() {
        assertEquals(
            listOf(
                "Kilo.Session.AutoApprove",
                "---",
                "Kilo.Session.CompareToBase",
                "Kilo.Session.OpenPr",
                "Kilo.Session.CopyPrRef",
                "---",
                "Kilo.Session.CopyId",
                "Kilo.Session.Share",
                "Kilo.Session.CopyShareLink",
            ),
            menuChildren("Kilo.Session.PromptMenu"),
        )
    }

    fun `test both menus reference only declared or platform actions`() {
        val declared = descriptor().getElementsByTagName("action").let { nodes ->
            (0 until nodes.length).mapNotNull { (nodes.item(it) as Element).getAttribute("id").takeIf(String::isNotEmpty) }
        }.toSet()

        for (group in listOf("Kilo.Session.ContextMenu", "Kilo.Session.PromptMenu")) {
            val missing = menuChildren(group)
                .filter { it != "---" && !it.startsWith("$") }
                .filterNot { it in declared }

            assertEquals("$group references undeclared action ids", emptyList<String>(), missing)
        }
    }

    /**
     * The declarations carry no inline text, so the bundle is the only source of the menu labels. A
     * missing key would render a blank menu item rather than failing anywhere else.
     */
    fun `test every declared session action has bundle text and description`() {
        val ids = (menuChildren("Kilo.Session.ContextMenu") + menuChildren("Kilo.Session.PromptMenu"))
            .filter { it.startsWith("Kilo.Session.") }
            .distinct()

        assertTrue("expected the new session actions in at least one menu", ids.isNotEmpty())
        // optional() consults containsKey; message() would return "!key!" and pass vacuously.
        val keys = ids.flatMap { listOf("action.$it.text", "action.$it.description") } +
            // The share item flips its wording, so it needs a second pair.
            listOf("action.Kilo.Session.Share.stop.text", "action.Kilo.Session.Share.stop.description")

        val missing = keys.filter { KiloBundle.optional(it).isNullOrBlank() }

        assertEquals("session actions missing bundle strings", emptyList<String>(), missing)
    }

    fun `test every menu action class is instantiable`() {
        val ids = menuChildren("Kilo.Session.ContextMenu") + menuChildren("Kilo.Session.PromptMenu")
        val classes = descriptor().getElementsByTagName("action").let { nodes ->
            (0 until nodes.length).map { nodes.item(it) as Element }
        }.filter { it.getAttribute("id") in ids }
            .map { it.getAttribute("class") }

        assertTrue("expected the new session actions to be declared", classes.isNotEmpty())
        for (name in classes) {
            assertNotNull(name, Class.forName(name).getDeclaredConstructor().newInstance())
        }
    }

    fun `test every owned menu action works during indexing`() {
        val ids = (menuChildren("Kilo.Session.ContextMenu") + menuChildren("Kilo.Session.PromptMenu"))
            .filter { it.startsWith("Kilo.") }
            .distinct()
        val actions = descriptor().getElementsByTagName("action").let { nodes ->
            (0 until nodes.length).map { nodes.item(it) as Element }
        }.filter { it.getAttribute("id") in ids }

        val blocked = actions.mapNotNull { action ->
            val cls = Class.forName(action.getAttribute("class"))
            action.getAttribute("id").takeUnless { DumbAware::class.java.isAssignableFrom(cls) }
        }

        assertEquals("menu actions blocked during indexing", emptyList<String>(), blocked)
    }

    // ---- context resolution from the transcript ----

    fun `test session context resolves from a target deep in the transcript`() {
        realDataManager()
        branch(BranchStatusDto(branch = "main", availability = GhAvailability.OK))
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()
        layout()

        val ctx = DataManager.getInstance().getDataContext(find<TextView>(ui))

        assertNotNull("SessionActions must resolve from the transcript", ctx.getData(SessionActionsKeys.ACTIONS))
        assertNotNull("PromptDataKeys.SEND must resolve from the transcript", ctx.getData(PromptDataKeys.SEND))
    }

    fun `test reused stop action is enabled from the transcript while a turn runs`() {
        realDataManager()
        rpc.history.addAll(history(1))
        ui = newUi(id = "ses_test")
        settle()
        layout()
        controller().model.setState(SessionState.Busy("running"))

        val event = eventAt(find<TextView>(ui), StopSessionAction())

        assertTrue(event.presentation.isEnabled)
    }

    // ---- auto-approve ----

    fun `test auto approve action reflects and flips state`() {
        val actions = Fake(id = "ses_test", auto = false)
        val action = SessionAutoApproveAction()
        val event = event(action, actions)

        ActionUtil.updateAction(action, event)
        assertTrue(event.presentation.isEnabledAndVisible)
        assertFalse(Toggleable.isSelected(event.presentation))

        action.setSelected(event, true)
        assertEquals(listOf(true), actions.autos)

        ActionUtil.updateAction(action, event)
        assertTrue(Toggleable.isSelected(event.presentation))
    }

    fun `test auto approve action hidden for readonly session`() {
        val action = SessionAutoApproveAction()
        val event = event(action, Fake(id = "ses_test", readonly = true))

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    // ---- compare to base ----

    fun `test compare to base hidden without git`() {
        val action = CompareToBaseAction()
        val event = event(action, Fake(id = "ses_test", git = false))

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabledAndVisible)
    }

    fun `test compare to base stays available when readonly`() {
        val action = CompareToBaseAction()
        val actions = Fake(id = "ses_test", git = true, readonly = true)
        val event = event(action, actions)

        ActionUtil.updateAction(action, event)
        assertTrue(event.presentation.isEnabledAndVisible)

        action.actionPerformed(event)
        assertEquals(1, actions.compares)
    }

    // ---- pull request ----

    fun `test pull request actions hidden without a pull request`() {
        val actions = Fake(id = "ses_test", pr = null)

        for (action in listOf(OpenSessionPrAction(), CopySessionPrRefAction())) {
            val event = event(action, actions)
            ActionUtil.updateAction(action, event)
            assertFalse(action::class.java.simpleName, event.presentation.isEnabledAndVisible)
        }
    }

    fun `test copy pull request reference uses title and url`() {
        val pr = WorktreePrDto(path = "/test", number = 42, state = GhState.OPEN, url = "https://host/x/y/pull/42", title = "Fix the thing")

        assertEquals("Fix the thing - https://host/x/y/pull/42", CopySessionPrRefAction.reference(pr))
    }

    fun `test copy pull request reference falls back to number when title is blank`() {
        val pr = WorktreePrDto(path = "/test", number = 42, state = GhState.OPEN, url = "https://host/x/y/pull/42")

        assertEquals("#42 - https://host/x/y/pull/42", CopySessionPrRefAction.reference(pr))
    }

    // ---- session id ----

    fun `test copy session id hidden until the session exists`() {
        val action = CopySessionIdAction()

        val absent = event(action, Fake(id = null))
        ActionUtil.updateAction(action, absent)
        assertFalse(absent.presentation.isEnabledAndVisible)

        val present = event(action, Fake(id = "ses_test"))
        ActionUtil.updateAction(action, present)
        assertTrue(present.presentation.isEnabledAndVisible)
    }

    // ---- share ----

    fun `test share action text flips on share state`() {
        val action = ShareSessionAction()

        val unshared = Fake(id = "ses_test", share = null)
        val off = event(action, unshared)
        ActionUtil.updateAction(action, off)
        assertTrue(off.presentation.isEnabledAndVisible)
        assertEquals("Share Session", off.presentation.text)
        action.actionPerformed(off)
        assertEquals(1, unshared.started)
        assertEquals(0, unshared.stopped)

        val shared = Fake(id = "ses_test", share = "https://app.kilo.ai/s/tok")
        val on = event(action, shared)
        ActionUtil.updateAction(action, on)
        assertEquals("Stop Sharing", on.presentation.text)
        action.actionPerformed(on)
        assertEquals(0, shared.started)
        assertEquals(1, shared.stopped)
    }

    fun `test share action hidden without a session and when readonly`() {
        val action = ShareSessionAction()

        for (actions in listOf(Fake(id = null), Fake(id = "ses_test", readonly = true))) {
            val event = event(action, actions)
            ActionUtil.updateAction(action, event)
            assertFalse(event.presentation.isEnabledAndVisible)
        }
    }

    fun `test copy share link visible only while shared`() {
        val action = CopyShareLinkAction()

        val off = event(action, Fake(id = "ses_test", share = null))
        ActionUtil.updateAction(action, off)
        assertFalse(off.presentation.isEnabledAndVisible)

        val on = event(action, Fake(id = "ses_test", share = "https://app.kilo.ai/s/tok"))
        ActionUtil.updateAction(action, on)
        assertTrue(on.presentation.isEnabledAndVisible)
    }

    // ---- helpers ----

    /**
     * `HeadlessDataManager` never traverses the Swing hierarchy by default, so every `UiDataProvider`
     * on the ancestor chain is ignored and even `COPY_PROVIDER` reads back null. Opt into the real
     * `DataManagerImpl` for the tests that assert context resolution.
     */
    private fun realDataManager() {
        HeadlessDataManager.fallbackToProductionDataManager(testRootDisposable)
    }

    /**
     * The plugin's declared actions are not registered with `ActionManager` in the test fixture (which
     * is why `BranchDock` null-guards its own lookups), so the menu's shape is asserted against the
     * module descriptor instead of a live `ActionGroup`.
     */
    private fun descriptor(): Document {
        val stream = javaClass.classLoader.getResourceAsStream("kilo.jetbrains.frontend.xml")
            ?: error("kilo.jetbrains.frontend.xml missing from the test classpath")
        return stream.use {
            DocumentBuilderFactory.newDefaultInstance().newDocumentBuilder().parse(it)
        }
    }

    private fun menuChildren(groupId: String): List<String> {
        val groups = descriptor().getElementsByTagName("group")
        val menu = (0 until groups.length)
            .map { groups.item(it) as Element }
            .firstOrNull { it.getAttribute("id") == groupId }
            ?: error("$groupId group missing")
        val children = menu.childNodes
        return (0 until children.length)
            .mapNotNull { children.item(it) as? Element }
            .mapNotNull { child ->
                when (child.tagName) {
                    "separator" -> "---"
                    "reference" -> child.getAttribute("ref")
                    else -> null
                }
            }
    }

    private fun branch(status: BranchStatusDto) {
        val worktree = FakeWorktreeRpcApi().apply { branchResult = status }
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(scope, worktree), testRootDisposable)
    }

    private fun event(action: AnAction, actions: SessionActions?): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val context = DataContext { id -> if (SessionActionsKeys.ACTIONS.`is`(id)) actions else null }
        return AnActionEvent.createFromDataContext("", presentation, context)
    }

    private fun eventAt(component: Component, action: AnAction): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val event = AnActionEvent.createFromDataContext(
            "",
            presentation,
            DataManager.getInstance().getDataContext(component),
        )
        ActionUtil.updateAction(action, event)
        return event
    }

    private class Fake(
        override val id: String?,
        override val readonly: Boolean = false,
        override val pr: WorktreePrDto? = null,
        override val share: String? = null,
        override val git: Boolean = true,
        auto: Boolean = false,
    ) : SessionActions {
        // Backing field rather than `override var auto`: a var would generate setAuto(Z)V and clash
        // with the interface's own setAuto.
        private var state = auto
        override val auto: Boolean get() = state
        val autos = mutableListOf<Boolean>()
        var compares = 0
        var started = 0
        var stopped = 0

        override fun setAuto(value: Boolean) {
            autos.add(value)
            state = value
        }

        override fun compare() {
            compares++
        }

        override fun startShare() {
            started++
        }

        override fun stopShare() {
            stopped++
        }
    }
}
