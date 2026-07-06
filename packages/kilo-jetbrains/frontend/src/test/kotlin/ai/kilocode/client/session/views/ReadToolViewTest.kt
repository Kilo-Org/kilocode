package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.base.SecondarySessionPartView
import ai.kilocode.client.session.views.tool.GlobToolView
import ai.kilocode.client.session.views.tool.ReadToolView
import ai.kilocode.client.session.views.tool.SearchToolView
import ai.kilocode.client.ui.UiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import javax.swing.ScrollPaneConstants

@Suppress("UnstableApiUsage")
class ReadToolViewTest : BasePlatformTestCase() {

    fun `test read tool shows filename`() {
        val t = tool().also { it.input = mapOf("filePath" to "README.MD") }

        val view = ReadToolView(t)
        val base: Any = view

        assertTrue(base is SecondarySessionPartView)
        assertTrue(view.labelText().contains("Read"))
        assertTrue(view.labelText().contains("README.MD"))
    }

    fun `test read tool handles windows path`() {
        val t = tool().also { it.input = mapOf("filePath" to "C:\\repo\\README.MD") }

        val view = ReadToolView(t)

        assertTrue(view.labelText().contains("README.MD"))
    }

    fun `test read file output renders filename hyperlink`() {
        val opened = mutableListOf<String>()
        val path = "/Users/kirillk/work/kilocode/.kilo/worktrees/agreeable-marlin/packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/session/SessionUiLayoutTest.kt"
        val t = tool().also {
            it.output = """
                <path>$path</path>
                <type>file</type>
                <content>
                content
                </content>
            """.trimIndent()
        }

        val view = ReadToolView(t, openFile = { href, _ -> opened.add(href) })

        assertTrue(view.linkVisible())
        assertEquals("SessionUiLayoutTest.kt", view.linkText())
        assertEquals(path, view.linkHref())
        assertTrue(view.linkMarkup().contains("<nobr><u>SessionUiLayoutTest.kt</u></nobr>"))
        assertEquals(UiStyle.Colors.fg().rgb, view.linkForeground().rgb)
        assertEquals(view.linkFont(), view.bodyFont())
        assertTrue(view.labelText().contains("SessionUiLayoutTest.kt"))

        view.openLink()

        assertEquals(listOf(path), opened)
    }

    fun `test read directory output remains plain text`() {
        val path = "/Users/kirillk/work/kilocode/packages/kilo-jetbrains"
        val t = tool().also {
            it.output = """
                <path>$path</path>
                <type>directory</type>
                <content></content>
            """.trimIndent()
        }

        val view = ReadToolView(t)

        assertFalse(view.linkVisible())
        assertNull(view.linkHref())
        assertEquals(UiStyle.Colors.fg().rgb, view.subtitleForeground().rgb)
        assertEquals(view.subtitleFont(), view.bodyFont())
        assertTrue(view.labelText().contains(path))
    }

    fun `test read output is secondary non expandable summary`() {
        val t = tool().also { it.output = "file contents" }
        val view = ReadToolView(t)

        assertFalse(view.hasToggle())
        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
        assertEquals("file contents", view.bodyText())
        assertTrue(view.bodyCreated())
        assertTrue(view.bodyWrap())
        assertNull(view.bodyEditor())
        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, view.horizontalPolicy())

        view.toggle()

        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())
    }

    fun `test read directory subtitle is normalized to one line`() {
        val t = tool().also { it.input = mapOf("filePath" to "dir\nchild") }
        val view = ReadToolView(t)

        assertTrue(view.labelText().contains("dir child"))
        assertFalse(view.labelText().contains("\n"))
    }

    fun `test view factory routes read kind tools to read tool view`() {
        assertTrue(ViewFactory.create(tool(), openFile = { _, _ -> }) is ReadToolView)
        assertTrue(ViewFactory.create(Tool("p2", "grep", toolKind("grep")), openFile = { _, _ -> }) is SearchToolView)
        assertTrue(ViewFactory.create(Tool("p3", "glob", toolKind("glob")), openFile = { _, _ -> }) is GlobToolView)
    }

    fun `test canRender matches read kind tools only`() {
        assertTrue(ReadToolView.canRender(tool()))
        assertTrue(ReadToolView.canRender(Tool("p2", "grep", toolKind("grep"))))
        assertTrue(ReadToolView.canRender(Tool("p3", "glob", toolKind("glob"))))
        assertFalse(ReadToolView.canRender(Tool("p4", "bash", toolKind("bash"))))
    }

    private fun tool() = Tool("p1", "read", toolKind("read")).also { it.state = ToolExecState.COMPLETED }
}
