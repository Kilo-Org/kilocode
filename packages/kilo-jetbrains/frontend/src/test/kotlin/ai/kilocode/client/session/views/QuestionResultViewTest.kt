package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.views.question.QuestionResultView
import com.intellij.testFramework.fixtures.BasePlatformTestCase

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

    // ------ view factory routing ------

    fun `test view factory uses question result view for completed parsable question tool`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val view = ViewFactory.create(tool)

        assertTrue(view is QuestionResultView)
    }

    fun `test view factory falls back to tool view for invalid question result`() {
        val tool = completedTool(
            input = emptyMap(),
            metadata = emptyMap(),
        )
        val view = ViewFactory.create(tool)

        assertTrue(view is ToolView)
    }

    fun `test view factory falls back to tool view for running question`() {
        val tool = runningTool("question")
        val view = ViewFactory.create(tool)

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

    fun `test applyStyle updates fonts`() {
        val tool = completedTool(
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val view = QuestionResultView(tool)
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)

        view.applyStyle(style)
        view.toggle()

        assertTrue(view.bodyFonts().contains(style.transcriptFont))
        assertTrue(view.bodyFonts().contains(style.boldEditorFont))
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
}
