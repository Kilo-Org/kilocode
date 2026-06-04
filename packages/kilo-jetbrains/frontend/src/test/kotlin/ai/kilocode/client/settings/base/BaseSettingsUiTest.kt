package ai.kilocode.client.settings.base

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import java.awt.Container
import javax.swing.AbstractButton
import javax.swing.JLabel
import javax.swing.text.JTextComponent

class BaseSettingsUiTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var appScope: CoroutineScope
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private var panel: FakePanel? = null

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        appScope = CoroutineScope(SupervisorJob())
        app = KiloAppService(appScope, FakeAppRpcApi())
        workspaces = KiloWorkspaceService(appScope, FakeWorkspaceRpcApi())
    }

    override fun tearDown() {
        try {
            val view = panel
            if (view != null) edt { view.dispose() }
            panel = null
            scope.cancel()
            appScope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test modified and reset use baseline`() {
        val view = create()

        edt {
            view.edit("new")
            assertTrue(view.modified())
            view.resetDraft()
            assertEquals("old", view.value())
            assertFalse(view.modified())
        }
    }

    fun `test pending save target is not modified`() {
        val view = create()

        edt {
            view.edit("new")
            view.applyDraft()
            assertFalse(view.modified())
            view.edit("other")
            assertTrue(view.modified())
        }
    }

    fun `test failed save keeps draft dirty and shows error`() {
        val view = create()

        edt {
            view.edit("new")
            view.applyDraft()
            view.fail()
        }
        flush()

        edt {
            assertEquals("new", view.value())
            assertTrue(view.modified())
            assertTrue(text(view.progress).contains("Failed"))
        }
    }

    fun `test edit clears save error`() {
        val view = create()

        edt {
            view.edit("new")
            view.applyDraft()
            view.fail()
        }
        flush()
        edt { view.edit("other") }
        flush()

        edt { assertFalse(text(view.progress).contains("Failed")) }
    }

    fun `test successful save preserves concurrent edit`() {
        val view = create()

        edt {
            view.edit("new")
            view.applyDraft()
            view.edit("other")
            view.succeed("new")
        }
        flush()

        edt {
            assertEquals("other", view.value())
            assertTrue(view.modified())
        }
    }

    fun `test failed save after dispose calls failure hook`() {
        val view = create()

        edt {
            view.edit("new")
            view.applyDraft()
            view.dispose()
            view.fail()
        }
        panel = null
        flush()

        assertEquals(1, view.disposedFailures)
    }

    fun `test login banner can be shown`() {
        val view = create()

        edt { view.banner(true) }

        edt { assertTrue(text(view).contains("Sign in to Kilo Code")) }
    }

    fun `test login banner can be disabled`() {
        val view = create(login = false)

        edt { view.banner(true) }

        edt { assertFalse(text(view).contains("Sign in to Kilo Code")) }
    }

    private fun create(login: Boolean = true): FakePanel {
        val view = edt { FakePanel(scope, app, workspaces, login) }
        panel = view
        return view
    }

    private fun flush() = runBlocking {
        edt { UIUtil.dispatchAllInvocationEvents() }
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun text(root: Container): String {
        val out = mutableListOf<String>()
        for (comp in components(root)) {
            if (!comp.isVisible) continue
            when (comp) {
                is AbstractButton -> comp.text?.let { out.add(it) }
                is JLabel -> comp.text?.let { out.add(it) }
                is JTextComponent -> comp.text?.let { out.add(it) }
            }
        }
        return out.joinToString("\n")
    }

    private fun components(root: Container): List<java.awt.Component> = buildList {
        fun visit(comp: java.awt.Component) {
            add(comp)
            if (comp is Container) comp.components.forEach { visit(it) }
        }
        visit(root)
    }

    private data class Draft(val value: String)
    private data class Change(val value: String)

    private class FakeContent : BaseContentPanel()

    private class FakePanel(
        cs: CoroutineScope,
        app: KiloAppService,
        workspaces: KiloWorkspaceService,
        login: Boolean,
    ) : BaseSettingsUi<FakeContent, Draft, Change, Draft, Unit>(cs, Draft("old"), app, workspaces, loginBanner = login) {
        private val callbacks = mutableListOf<(Draft?) -> Unit>()
        var disposedFailures = 0
            private set

        init {
            startSettings(FakeContent())
        }

        fun edit(value: String) = updateDraft { copy(value = value) }

        fun value(): String = draft.value

        fun succeed(value: String) = callbacks.removeAt(0)(Draft(value))

        fun fail() = callbacks.removeAt(0)(null)

        fun banner(login: Boolean) = syncLoginBanner(login) { top.hideBanner() }

        override fun change(from: Draft, to: Draft): Change? = if (from == to) null else Change(to.value)

        override fun save(change: Change, done: (Draft?) -> Unit) {
            callbacks += done
        }

        override fun base(result: Draft): Draft = result

        override fun draft(state: KiloAppStateDto): Draft = draft

        override suspend fun loadWorkspace(root: String) = Unit

        override fun applyWorkspace(result: Unit) = Unit

        override fun syncContent() {
            val err = saveError
            if (saving) {
                showProgress(pendingText())
                return
            }
            if (err != null) {
                showError(err)
                return
            }
            clearProgress()
        }

        override fun pendingText(): String = "Saving"

        override fun failedText(): String = "Failed"

        override fun onSaveFailedAfterDispose(change: Change) {
            disposedFailures++
        }
    }
}
