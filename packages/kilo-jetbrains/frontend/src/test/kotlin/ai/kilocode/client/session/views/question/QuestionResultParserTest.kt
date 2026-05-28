package ai.kilocode.client.session.views.question

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import junit.framework.TestCase

class QuestionResultParserTest : TestCase() {

    // ------ parse returns null for ineligible tools ------

    fun `test non-question tool returns null`() {
        val tool = tool("bash", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"question":"Q1"}]"""))
        assertNull(QuestionResultParser.parse(tool))
    }

    fun `test running question tool returns null`() {
        val tool = tool("question", ToolExecState.RUNNING, input = mapOf("questions" to """[{"question":"Q1"}]"""))
        assertNull(QuestionResultParser.parse(tool))
    }

    fun `test pending question tool returns null`() {
        val tool = tool("question", ToolExecState.PENDING, input = mapOf("questions" to """[{"question":"Q1"}]"""))
        assertNull(QuestionResultParser.parse(tool))
    }

    fun `test error state question tool returns null`() {
        val tool = tool("question", ToolExecState.ERROR, input = mapOf("questions" to """[{"question":"Q1"}]"""))
        assertNull(QuestionResultParser.parse(tool))
    }

    // ------ missing or invalid questions input ------

    fun `test missing questions key returns null`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = emptyMap())
        assertNull(QuestionResultParser.parse(tool))
    }

    fun `test invalid questions JSON returns null`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to "not json"))
        assertNull(QuestionResultParser.parse(tool))
    }

    fun `test empty questions array returns null`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to "[]"))
        assertNull(QuestionResultParser.parse(tool))
    }

    fun `test blank question strings are ignored and empty result returns null`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"question":"   "}]"""))
        assertNull(QuestionResultParser.parse(tool))
    }

    fun `test question object missing question key is ignored`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"header":"no question field"}]"""))
        assertNull(QuestionResultParser.parse(tool))
    }

    // ------ valid questions parsing ------

    fun `test single valid question is parsed`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"question":"Which strategy?"}]"""))
        val result = QuestionResultParser.parse(tool)
        assertNotNull(result)
        assertEquals(listOf("Which strategy?"), result!!.questions)
    }

    fun `test multiple valid questions are parsed`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"question":"Q1"},{"question":"Q2"}]"""))
        val result = QuestionResultParser.parse(tool)
        assertNotNull(result)
        assertEquals(listOf("Q1", "Q2"), result!!.questions)
    }

    fun `test blank questions are filtered out leaving valid ones`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"question":"  "},{"question":"Real question"}]"""))
        val result = QuestionResultParser.parse(tool)
        assertNotNull(result)
        assertEquals(listOf("Real question"), result!!.questions)
    }

    // ------ answers parsing ------

    fun `test missing answers metadata produces empty answer lists`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"question":"Q1"}]"""), metadata = emptyMap())
        val result = QuestionResultParser.parse(tool)!!
        assertEquals(emptyList<List<String>>(), result.answers)
    }

    fun `test blank answers metadata produces empty answer lists`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"question":"Q1"}]"""), metadata = mapOf("answers" to "   "))
        val result = QuestionResultParser.parse(tool)!!
        assertEquals(emptyList<List<String>>(), result.answers)
    }

    fun `test invalid answers JSON produces empty answer lists`() {
        val tool = tool("question", ToolExecState.COMPLETED, input = mapOf("questions" to """[{"question":"Q1"}]"""), metadata = mapOf("answers" to "not json"))
        val result = QuestionResultParser.parse(tool)!!
        assertEquals(emptyList<List<String>>(), result.answers)
    }

    fun `test valid answers are parsed`() {
        val tool = tool(
            "question", ToolExecState.COMPLETED,
            input = mapOf("questions" to """[{"question":"Q1"},{"question":"Q2"}]"""),
            metadata = mapOf("answers" to """[["Answer1"],["Answer2"]]"""),
        )
        val result = QuestionResultParser.parse(tool)!!
        assertEquals(listOf(listOf("Answer1"), listOf("Answer2")), result.answers)
    }

    fun `test multi-answer row is parsed as list`() {
        val tool = tool(
            "question", ToolExecState.COMPLETED,
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["A","B","C"]]"""),
        )
        val result = QuestionResultParser.parse(tool)!!
        assertEquals(listOf(listOf("A", "B", "C")), result.answers)
    }

    fun `test blank strings in answer rows are filtered out`() {
        val tool = tool(
            "question", ToolExecState.COMPLETED,
            input = mapOf("questions" to """[{"question":"Q1"}]"""),
            metadata = mapOf("answers" to """[["   ","Valid","  "]]"""),
        )
        val result = QuestionResultParser.parse(tool)!!
        assertEquals(listOf(listOf("Valid")), result.answers)
    }

    fun `test answers count can differ from questions count`() {
        val tool = tool(
            "question", ToolExecState.COMPLETED,
            input = mapOf("questions" to """[{"question":"Q1"},{"question":"Q2"}]"""),
            metadata = mapOf("answers" to """[["A1"]]"""),
        )
        val result = QuestionResultParser.parse(tool)!!
        assertEquals(2, result.questions.size)
        assertEquals(1, result.answers.size)
    }

    // ------ helpers ------

    private fun tool(
        name: String,
        state: ToolExecState,
        input: Map<String, String> = emptyMap(),
        metadata: Map<String, String> = emptyMap(),
    ): Tool = Tool("tp1", name, toolKind(name)).apply {
        this.state = state
        this.input = input
        this.metadata = metadata
    }
}
