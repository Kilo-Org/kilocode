package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.tool.GlobToolView
import ai.kilocode.client.session.views.tool.ReadToolView
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class GlobToolViewTest : BasePlatformTestCase() {
    private val views = mutableListOf<GlobToolView>()

    override fun tearDown() {
        try {
            views.forEach(Disposer::dispose)
            views.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test header renders title directory and pattern rows`() {
        val view = GlobToolView(tool().also {
            it.input = mapOf("path" to "/repo/src", "pattern" to "**/*.kt")
        })

        assertTrue(view.labelText().contains("Glob"))
        assertEquals(listOf("/repo/src", "pattern=**/*.kt"), view.targetTexts())
        assertTrue(view.targetVisible(1))
    }

    fun `test pattern row hides when pattern is absent`() {
        val view = GlobToolView(tool().also {
            it.input = mapOf("path" to "/repo/src")
        })

        assertEquals(listOf("/repo/src"), view.targetTexts())
        assertFalse(view.targetVisible(1))
    }

    fun `test repo path displays relative directory`() {
        val view = GlobToolView(tool().also {
            it.input = mapOf("path" to "/repo/src", "pattern" to "**/*.kt")
        }, repo = "/repo")

        assertEquals(listOf("src", "pattern=**/*.kt"), view.targetTexts())
    }

    fun `test repo root directory is hidden`() {
        val exact = GlobToolView(tool().also {
            it.input = mapOf("path" to "/repo", "pattern" to "**/*.kt")
        }, repo = "/repo")
        val dot = GlobToolView(tool().also {
            it.input = mapOf("path" to ".", "pattern" to "**/*.kt")
        }, repo = "/repo")

        assertEquals(listOf("pattern=**/*.kt"), exact.targetTexts())
        assertEquals(listOf("pattern=**/*.kt"), dot.targetTexts())
        assertFalse(exact.targetVisible(1))
        assertFalse(dot.targetVisible(1))
    }

    fun `test outside repo directory stays absolute`() {
        val view = GlobToolView(tool().also {
            it.input = mapOf("path" to "/other/src", "pattern" to "**/*.kt")
        }, repo = "/repo")

        assertEquals(listOf("/other/src", "pattern=**/*.kt"), view.targetTexts())
    }

    fun `test target labels use regular font`() {
        val view = GlobToolView(tool().also {
            it.input = mapOf("path" to "/repo/src", "pattern" to "**/*.kt")
        })
        val style = SessionEditorStyle.current()

        assertEquals(style.regularFont, view.targetFont(0))
        assertEquals(style.regularFont, view.targetFont(1))
    }

    fun `test target labels normalize newlines for one line clipping`() {
        val view = GlobToolView(tool().also {
            it.input = mapOf("path" to "/repo/src\nnested", "pattern" to "**/*.kt\n*.kts")
        })

        assertEquals(listOf("/repo/src nested", "pattern=**/*.kt *.kts"), view.targetTexts())
        assertFalse(view.targetComponents().any { it.text.contains("\n") })
    }

    fun `test completed glob starts collapsed and expands output`() {
        val view = track(GlobToolView(tool().also { it.output = "/repo/src/A.kt\n/repo/src/B.kt" }))

        assertTrue(view.hasToggle())
        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        assertEquals("/repo/src/A.kt\n/repo/src/B.kt", view.bodyText())

        view.toggle()

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertEquals("/repo/src/A.kt\n/repo/src/B.kt", view.bodyText())
    }

    fun `test glob body is lazy and reused`() {
        val view = track(GlobToolView(tool().also { it.output = "/repo/src/A.kt" }))

        assertFalse(view.bodyCreated())
        view.toggle()
        val body = view.scrollComponent()
        val editor = view.bodyEditor()
        assertNotNull(body)
        assertNotNull(editor)
        assertFalse(view.bodyWrap())
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, view.horizontalPolicy())
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, view.verticalPolicy())

        view.toggle()
        assertFalse(view.bodyVisible())
        view.toggle()

        assertSame(body, view.scrollComponent())
        assertSame(editor, view.bodyEditor())
        assertTrue(view.bodyVisible())
    }

    fun `test collapsed update keeps glob body uncreated`() {
        val view = GlobToolView(tool().also { it.output = "/repo/src/A.kt" })

        view.update(tool().also { it.output = "/repo/src/B.kt" })

        assertFalse(view.bodyCreated())
        assertEquals("/repo/src/B.kt", view.bodyText())
    }

    fun `test view factory routes glob to glob tool view`() {
        assertTrue(ViewFactory.create(tool(), openFile = { _, _ -> }) is GlobToolView)
    }

    fun `test should replace when glob renderer changes`() {
        val glob = tool()
        val read = Tool("p1", "read", toolKind("read")).also { it.state = ToolExecState.COMPLETED }

        assertTrue(ViewFactory.shouldReplace(ReadToolView(read), glob))
        assertTrue(ViewFactory.shouldReplace(ToolView(read), glob))
        assertTrue(ViewFactory.shouldReplace(GlobToolView(glob), read))
        assertFalse(ViewFactory.shouldReplace(GlobToolView(glob), glob))
    }

    fun `test glob header popup previews matches when collapsed`() {
        val view = track(GlobToolView(tool().also {
            it.input = mapOf("pattern" to "**/*.kt")
            it.output = "src/A.kt\nsrc/B.kt"
        }))
        val body = view.headerPopup()!!.build()
        try {
            val editors = popupEditors(body.component)
            editors.forEach { it.getEditor(true) }
            assertEquals(listOf("src/A.kt\nsrc/B.kt"), editors.map { it.text })
            assertTrue(body.component.preferredSize.height in 1..JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT))
        } finally {
            Disposer.dispose(body.disposable)
        }
    }

    fun `test glob header popup is absent when expanded and leaks no editors`() {
        val base = EditorFactory.getInstance().allEditors.size
        val view = track(GlobToolView(tool().also { it.output = "src/A.kt" }))
        assertNotNull(view.headerPopup())
        repeat(20) {
            val body = view.headerPopup()!!.build()
            popupEditors(body.component).forEach { it.getEditor(true) }
            Disposer.dispose(body.disposable)
        }
        UIUtil.dispatchAllInvocationEvents()
        assertEquals(base, EditorFactory.getInstance().allEditors.size)
        view.toggle()
        assertNull(view.headerPopup())
    }

    private fun tool() = Tool("p1", "glob", toolKind("glob")).also { it.state = ToolExecState.COMPLETED }

    private fun track(view: GlobToolView): GlobToolView {
        views.add(view)
        return view
    }
}
