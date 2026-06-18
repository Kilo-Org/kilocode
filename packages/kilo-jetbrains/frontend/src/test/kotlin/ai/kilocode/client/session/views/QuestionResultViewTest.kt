package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.question.QuestionResultView
import ai.kilocode.client.session.views.tool.ToolView
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.swing.Icon
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.border.Border

@Suppress("UnstableApiUsage")
class QuestionResultViewTest : BasePlatformTestCase() {

    // ------ canRender (integration with parser) ------

    fun `test completed question tool with valid data is renderable`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Which strategy?"},{"question":"Which checks?"}]"""),
            metadata = mapOf("answers" to """[["Comprehensive"],["Build"]]"""),
        )
        assertTrue(QuestionResultView.canRender(tool))
    }

    fun `test completed question tool without questions is not renderable`() {
        assertFalse(QuestionResultView.canRender(completedTool(input = emptyMap(), metadata = emptyMap())))
    }

    fun `test running question tool is not renderable`() {
        assertFalse(QuestionResultView.canRender(runningTool("question")))
    }

    // ------ label text ------

    fun `test completed question tool renders answer summary`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Which implementation strategy should we use?"},{"question":"Which validation checks should be run?"}]"""),
            metadata = mapOf("answers" to """[["Comprehensive"],["Build"]]"""),
            output = "User has answered your questions: raw output should not be rendered",
        )
        val view = QuestionResultView(tool)

        assertTrue(view.labelText().contains("Questions"))
        assertTrue(view.labelText().contains("2 answered"))
        assertTrue(view.bodyText().contains("Which implementation strategy should we use?"))
        assertTrue(view.bodyText().contains("Which validation checks should be run?"))
        assertTrue(view.bodyText().contains("Comprehensive"))
        assertTrue(view.bodyText().contains("Build"))
        assertFalse(view.bodyText().contains("raw output should not be rendered"))
    }

    fun `test collapsed view does not create body components`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val view = QuestionResultView(tool)

        assertFalse("Default collapsed state should not eagerly create body", view.bodyCreated())
        assertTrue(view.bodyText().contains("Q1"))
        assertFalse("Reading assertion text should not create Swing body", view.bodyCreated())
    }

    fun `test missing answer renders not answered`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"},{"question":"Q2"}]"""),
            metadata = mapOf("answers" to """[["Answer1"]]"""),
        )
        val view = QuestionResultView(tool)

        assertTrue(view.bodyText().contains("Q1"))
        assertTrue(view.bodyText().contains("Answer1"))
        assertTrue(view.bodyText().contains("Q2"))
        assertTrue(view.bodyText().contains("(not answered)"))
    }

    fun `test no answers metadata renders all not answered`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = emptyMap(),
        )
        val view = QuestionResultView(tool)

        assertTrue(view.bodyText().contains("Q1"))
        assertTrue(view.bodyText().contains("(not answered)"))
    }

    fun `test multi answer row joins with comma`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Select features"}]"""),
            metadata = mapOf("answers" to """[["Manual verification","Unit tests"]]"""),
        )
        val view = QuestionResultView(tool)

        assertTrue(view.bodyText().contains("Manual verification, Unit tests"))
    }

    fun `test label shows count of non-empty answers`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"},{"question":"Q2"}]"""),
            metadata = mapOf("answers" to """[["A1"],[]]"""),
        )
        val view = QuestionResultView(tool)

        // Only 1 non-empty answer
        assertTrue(view.labelText().contains("1 answered"))
    }

    // ------ toggle expand/collapse ------

    fun `test toggle collapses and expands body`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val view = QuestionResultView(tool)

        assertFalse("Default state should be collapsed", view.isExpanded())

        view.toggle()
        assertTrue("Should be expanded after toggle", view.isExpanded())

        view.toggle()
        assertFalse("Should be collapsed after second toggle", view.isExpanded())
    }

    fun `test toggle uses right and down chevron icons`() {
        val view = QuestionResultView(completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        ))

        assertTrue(icons(view).contains(SessionViewIcons.chevronCollapsed))
        assertTrue(icons(view).contains(SessionViewIcons.chevronRight))
        val closed = SessionViewIcons.chevronCollapsed

        view.toggle()

        assertTrue(icons(view).contains(SessionViewIcons.chevronExpanded))
        assertTrue(icons(view).contains(SessionViewIcons.chevronDown))
        assertEquals(closed.iconWidth, SessionViewIcons.chevronExpanded.iconWidth)
        assertEquals(closed.iconHeight, SessionViewIcons.chevronExpanded.iconHeight)
    }

    fun `test hover only changes header background`() {
        val view = QuestionResultView(completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        ))
        val root = view.node(0)
        val header = root.node(0)

        assertEquals(0, paint(root.border).alpha)
        view.toggle()
        val body = root.node(1)

        view.setHovered(true)

        assertEquals(SessionUiStyle.View.Surface.headerHoverBgColor().rgb, header.background.rgb)
        assertLine(root.border)
        assertEquals(SessionUiStyle.View.Outline.brightColor().rgb, paint(body.border).rgb)
        view.setHovered(false)
        assertEquals(SessionUiStyle.View.Surface.headerBgColor().rgb, header.background.rgb)
        assertLine(root.border)
    }

    // ------ view factory routing ------

    fun `test view factory uses question result view for completed parsable question tool`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val view = ViewFactory.create(tool, {}) {}

        assertTrue(view is QuestionResultView)
    }

    fun `test view factory falls back to tool view for invalid question result`() {
        val tool = completedTool(
            input = emptyMap(),
            metadata = emptyMap(),
        )
        val view = ViewFactory.create(tool, {}) {}

        assertTrue(view is ToolView)
    }

    fun `test view factory falls back to tool view for running question`() {
        val tool = runningTool("question")
        val view = ViewFactory.create(tool, {}) {}

        assertTrue(view is ToolView)
    }

    // ------ dumpLabel ------

    fun `test dumpLabel format`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val view = QuestionResultView(tool)

        assertTrue(view.dumpLabel().startsWith("QuestionResultView#"))
        assertTrue(view.dumpLabel().contains("Questions"))
    }

    // ------ applyStyle ------

    fun `test applyStyle updates body fonts to UI font family`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val view = QuestionResultView(tool)
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)

        view.applyStyle(style)
        view.toggle()

        assertTrue(view.bodyFonts().contains(style.regularFont))
        assertTrue(view.bodyFonts().contains(style.boldFont))
        assertFalse("Body should not use editor transcript font", view.bodyFonts().any { it.name == "Courier New" })
    }

    fun `test applyStyle updates header label fonts to UI font family`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val view = QuestionResultView(tool)
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)

        view.applyStyle(style)

        assertEquals("Title should use boldFont", style.boldFont, view.titleFont())
        assertEquals("Subtitle should use smallFont", style.smallFont, view.subFont())
        assertFalse("Title should not use editor font family", view.titleFont().name == "Courier New")
        assertFalse("Subtitle should not use editor font family", view.subFont().name == "Courier New")
    }

    // ------ update ------

    fun `test update with completed structured tool refreshes content`() {
        val initial = completedTool(
            input = mapOf("questions" to """[{"question":"Initial Q"}]"""),
            metadata = mapOf("answers" to """[["Initial A"]]"""),
        )
        val view = QuestionResultView(initial)

        val updated = completedTool(
            id = initial.id,
            input = mapOf("questions" to """[{"question":"Updated Q"}]"""),
            metadata = mapOf("answers" to """[["Updated A"]]"""),
        )
        view.update(updated)

        assertFalse("Collapsed update should not create body components", view.bodyCreated())
        assertTrue(view.bodyText().contains("Updated Q"))
        assertTrue(view.bodyText().contains("Updated A"))
        assertFalse(view.bodyText().contains("Initial Q"))
    }

    // ------ helpers ------

    private fun completedTool(
        id: String = "tp1",
        name: String = "question",
        input: Map<String, String> = emptyMap(),
        metadata: Map<String, String> = emptyMap(),
        output: String? = null,
    ): Tool = Tool(id, name, toolKind(name)).apply {
        state = ToolExecState.COMPLETED
        this.input = input
        this.metadata = metadata
        this.output = output
    }

    private fun runningTool(name: String, id: String = "tp1"): Tool =
        Tool(id, name, toolKind(name)).apply { state = ToolExecState.RUNNING }

    private fun Container.node(index: Int) = components[index] as JPanel

    private fun enter(component: Component) = event(component, MouseEvent.MOUSE_ENTERED)

    private fun exit(component: Component) = event(component, MouseEvent.MOUSE_EXITED)

    private fun event(component: Component, id: Int) {
        component.dispatchEvent(MouseEvent(
            component,
            id,
            System.currentTimeMillis(),
            0,
            1,
            1,
            0,
            false,
        ))
    }

    private fun paint(border: Border): Color {
        val image = BufferedImage(3, 3, BufferedImage.TYPE_INT_ARGB)
        val panel = JPanel()
        val graphics = image.createGraphics()
        border.paintBorder(panel, graphics, 0, 0, image.width, image.height)
        graphics.dispose()
        return Color(image.getRGB(0, 0), true)
    }

    private fun assertLine(border: Border) {
        val image = BufferedImage(5, 5, BufferedImage.TYPE_INT_ARGB)
        val panel = JPanel()
        val graphics = image.createGraphics()
        border.paintBorder(panel, graphics, 0, 0, image.width, image.height)
        graphics.dispose()
        val rgb = SessionUiStyle.View.Outline.brightColor().rgb
        assertEquals(rgb, Color(image.getRGB(2, 0), true).rgb)
        assertEquals(rgb, Color(image.getRGB(0, 2), true).rgb)
        assertEquals(rgb, Color(image.getRGB(4, 2), true).rgb)
        assertEquals(rgb, Color(image.getRGB(2, 4), true).rgb)
    }

    private fun icons(component: Component): List<Icon> {
        val found = mutableListOf<Icon>()
        collect(component, found)
        return found
    }

    private fun collect(component: Component, found: MutableList<Icon>) {
        if (component is JLabel) component.icon?.let(found::add)
        if (component is Container) component.components.forEach { collect(it, found) }
    }

}
