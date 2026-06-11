package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.session.views.tool.GlobToolView
import ai.kilocode.client.session.views.tool.ReadToolView
import ai.kilocode.client.session.views.tool.SearchToolView
import ai.kilocode.client.session.views.tool.ToolView
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Container
import java.awt.Dimension
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class SearchToolViewTest : BasePlatformTestCase() {
    private val views = mutableListOf<SearchToolView>()

    override fun tearDown() {
        try {
            views.forEach(Disposer::dispose)
            views.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test header renders title pattern and include targets`() {
        val view = SearchToolView(tool().also {
            it.input = mapOf("pattern" to "class SearchToolView", "include" to "*.{kt,kts}")
        })
        val base: Any = view

        assertTrue(base is SecondarySessionPartView)
        assertTrue(view.labelText().contains("Search"))
        assertEquals(listOf("pattern=class SearchToolView", "include=*.{kt,kts}"), view.targetTexts())
        assertTrue(view.targetVisible(0))
        assertTrue(view.targetVisible(1))
        assertFalse(view.targetVisible(2))
    }

    fun `test header includes optional path target`() {
        val view = SearchToolView(tool().also {
            it.input = mapOf("path" to "/repo/src", "pattern" to "TODO", "include" to "*.kt")
        })

        assertEquals(listOf("/repo/src", "pattern=TODO", "include=*.kt"), view.targetTexts())
    }

    fun `test repo path displays relative search target`() {
        val view = SearchToolView(tool().also {
            it.input = mapOf("path" to "/repo/src", "pattern" to "TODO", "include" to "*.kt")
        }, repo = "/repo")

        assertEquals(listOf("src", "pattern=TODO", "include=*.kt"), view.targetTexts())
    }

    fun `test repo root search path is hidden`() {
        val exact = SearchToolView(tool().also {
            it.input = mapOf("path" to "/repo", "pattern" to "TODO", "include" to "*.kt")
        }, repo = "/repo")
        val dot = SearchToolView(tool().also {
            it.input = mapOf("path" to ".", "pattern" to "TODO", "include" to "*.kt")
        }, repo = "/repo")

        assertEquals(listOf("pattern=TODO", "include=*.kt"), exact.targetTexts())
        assertEquals(listOf("pattern=TODO", "include=*.kt"), dot.targetTexts())
        assertTrue(exact.targetVisible(0))
        assertFalse(exact.targetVisible(2))
        assertTrue(dot.targetVisible(0))
        assertFalse(dot.targetVisible(2))
    }

    fun `test outside repo search path stays absolute`() {
        val view = SearchToolView(tool().also {
            it.input = mapOf("path" to "/other/src", "pattern" to "TODO", "include" to "*.kt")
        }, repo = "/repo")

        assertEquals(listOf("/other/src", "pattern=TODO", "include=*.kt"), view.targetTexts())
    }

    fun `test target labels use plain text for clipping`() {
        val view = SearchToolView(tool().also {
            it.input = mapOf("pattern" to "<unsafe>", "include" to "*.kt")
        })

        assertEquals("pattern=<unsafe>", view.targetComponents().first().text)
    }

    fun `test target labels use regular font`() {
        val view = SearchToolView(tool().also {
            it.input = mapOf("pattern" to "TODO", "include" to "*.kt")
        })
        val style = SessionEditorStyle.current()

        assertEquals(style.regularFont, view.targetFont(0))
        assertEquals(style.regularFont, view.targetFont(1))
    }

    fun `test completed search starts collapsed and expands output`() {
        val view = track(SearchToolView(tool().also { it.output = "src/A.kt:1:class A" }))

        assertTrue(view.hasToggle())
        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        assertEquals("src/A.kt:1:class A", view.bodyText())

        view.toggle()

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertEquals("src/A.kt:1:class A", view.bodyText())
    }

    fun `test search body is lazy and reused`() {
        val view = track(SearchToolView(tool().also { it.output = "src/A.kt" }))

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

    fun `test collapsed update keeps search body uncreated`() {
        val view = SearchToolView(tool().also { it.output = "src/A.kt" })

        view.update(tool().also { it.output = "src/B.kt" })

        assertFalse(view.bodyCreated())
        assertEquals("src/B.kt", view.bodyText())
    }

    fun `test long targets stay horizontal and do not force header wider`() {
        val view = SearchToolView(tool().also {
            it.input = mapOf(
                "pattern" to "a".repeat(200),
                "include" to "**/*.${"b".repeat(200)}.kt",
            )
        })
        val header = view.headerComponent()
        header.setSize(Dimension(240, header.preferredSize.height))

        layout(header)

        assertTrue(view.centerComponent().width <= header.width)
        val labels = view.targetComponents().filter { it.isVisible }
        assertEquals(labels.first().y, labels.last().y)
        labels.forEach {
            assertTrue(it.width <= view.centerComponent().width)
        }
    }

    fun `test view factory routes grep to search tool view`() {
        assertTrue(ViewFactory.create(tool(), openFile = {}) is SearchToolView)
    }

    fun `test should replace when search renderer changes`() {
        val search = tool()
        val read = Tool("p1", "read", toolKind("read")).also { it.state = ToolExecState.COMPLETED }
        val glob = Tool("p2", "glob", toolKind("glob")).also { it.state = ToolExecState.COMPLETED }

        assertTrue(ViewFactory.shouldReplace(ReadToolView(read), search))
        assertTrue(ViewFactory.shouldReplace(ToolView(read), search))
        assertTrue(ViewFactory.shouldReplace(SearchToolView(search), read))
        assertTrue(ViewFactory.shouldReplace(GlobToolView(glob, selection = null), search))
        assertFalse(ViewFactory.shouldReplace(SearchToolView(search), search))
    }

    private fun layout(root: Container) {
        root.doLayout()
        root.components.filterIsInstance<Container>().forEach { layout(it) }
    }

    private fun tool() = Tool("p1", "grep", toolKind("grep")).also { it.state = ToolExecState.COMPLETED }

    private fun track(view: SearchToolView): SearchToolView {
        views.add(view)
        return view
    }
}
