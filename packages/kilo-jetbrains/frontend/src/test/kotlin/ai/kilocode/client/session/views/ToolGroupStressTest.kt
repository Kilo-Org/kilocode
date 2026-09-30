package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil

@Suppress("UnstableApiUsage")
class ToolGroupStressTest : BasePlatformTestCase() {

    override fun setUp() {
        super.setUp()
        unsetCompactSettings()
        KiloPluginSettings.setCompactMode(true)
    }

    override fun tearDown() {
        try {
            unsetCompactSettings()
        } finally {
            super.tearDown()
        }
    }

    // A long run streaming into a collapsed group must stay bounded: one group card plus the single
    // renderer that existed before the run was recognised, no matter how many tools arrive.
    fun `test a long collapsed run keeps the component count flat`() {
        val view = assistant()
        val tools = (0 until 200).map { edit(it) }

        tools.forEach { view.upsertPart(it) }
        drainEdt()

        assertEquals("one group card", 1, view.groupViews().size)
        assertEquals(1, view.componentCount)
        assertEquals(200, view.groupViews().first().ids().size)
        assertEquals("no children built while collapsed", 0, view.groupViews().first().attachedCount())
        assertEquals("only the pre-run card exists", 1, view.partIds().count { view.part(it) != null })
    }

    // Streaming state updates into a collapsed group must not build renderers either.
    fun `test state churn on a collapsed run builds nothing`() {
        val view = assistant()
        val tools = (0 until 50).map { edit(it) }
        tools.forEach { view.upsertPart(it) }

        repeat(20) {
            for (tool in tools) {
                tool.state = if (it % 2 == 0) ToolExecState.RUNNING else ToolExecState.COMPLETED
                view.upsertPart(tool)
            }
        }
        drainEdt()

        assertEquals(0, view.groupViews().first().attachedCount())
    }

    fun `test expand and collapse churn releases every editor`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(15) {
            val view = assistant()
            (0 until 8).forEach { index -> view.upsertPart(edit(index)) }
            val group = view.groupViews().first()
            repeat(3) {
                group.expand()
                group.collapse()
            }
            group.expand()
            Disposer.dispose(view)
        }
        drainEdt()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    fun `test toggling compact mode repeatedly releases every editor`() {
        val base = EditorFactory.getInstance().allEditors.size

        repeat(10) {
            val view = assistant()
            (0 until 6).forEach { index -> view.upsertPart(edit(index)) }
            repeat(4) {
                KiloPluginSettings.setCompactMode(false)
                view.syncCompact()
                KiloPluginSettings.setCompactMode(true)
                view.syncCompact()
            }
            Disposer.dispose(view)
        }
        drainEdt()

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun assistant(): MessageView {
        val msg = Message(MessageDto("m1", "ses", "assistant", MessageTimeDto(0.0)))
        // MessageView owns its part renderers, so every run has to be disposed or the retained
        // pre-run card's Swing tree (and any editor it holds) outlives the test.
        return MessageView(msg, openFile = { _, _ -> }).also { Disposer.register(testRootDisposable, it) }
    }

    private fun edit(index: Int) = Tool("t$index", "edit", toolKind("edit")).also {
        it.state = ToolExecState.RUNNING
        it.input = mapOf("filePath" to "/repo/src/File$index.kt")
    }

    private fun drainEdt() {
        UIUtil.dispatchAllInvocationEvents()
    }
}
