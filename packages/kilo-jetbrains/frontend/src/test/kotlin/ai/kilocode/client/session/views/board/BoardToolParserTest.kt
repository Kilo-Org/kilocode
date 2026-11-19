package ai.kilocode.client.session.views.board

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import junit.framework.TestCase

class BoardToolParserTest : TestCase() {

    // ------ gating ------

    fun `test non-board tool returns null`() {
        val tool = tool("bash", ToolExecState.COMPLETED, output = """{"from":"main","to":"ALL","type":"INFO","body":"hi"}""")
        assertNull(BoardToolParser.parse(tool))
    }

    fun `test running board tool returns null`() {
        val tool = tool("board_post", ToolExecState.RUNNING, output = """{"from":"main","to":"ALL","type":"INFO","body":"hi"}""")
        assertNull(BoardToolParser.parse(tool))
    }

    fun `test pending board tool returns null`() {
        val tool = tool("board_read", ToolExecState.PENDING, output = null)
        assertNull(BoardToolParser.parse(tool))
    }

    fun `test error state board tool returns null`() {
        val tool = tool("board_post", ToolExecState.ERROR, output = null)
        assertNull(BoardToolParser.parse(tool))
    }

    fun `test blank output returns null`() {
        val tool = tool("board_post", ToolExecState.COMPLETED, output = "")
        assertNull(BoardToolParser.parse(tool))
    }

    fun `test malformed json returns null`() {
        val tool = tool("board_post", ToolExecState.COMPLETED, output = "not json")
        assertNull(BoardToolParser.parse(tool))
    }

    // ------ board_post ------

    fun `test board_post parses a single message from output`() {
        val tool = tool(
            "board_post", ToolExecState.COMPLETED,
            output = """{"id":"m1","from":"main","to":"ALL","type":"INFO","body":"status update"}""",
        )
        val result = BoardToolParser.parse(tool)
        assertNotNull(result)
        assertFalse(result!!.read)
        assertEquals(1, result.messages.size)
        val message = result.messages.single()
        assertEquals("main", message.from)
        assertEquals("ALL", message.to)
        assertEquals("INFO", message.type)
        assertEquals("status update", message.body)
        assertNull(result.warning)
    }

    fun `test board_post prefers metadata route over output`() {
        val tool = tool(
            "board_post", ToolExecState.COMPLETED,
            output = """{"id":"m1","from":"ses_a","to":"ses_b","fromLabel":"stale-from","toLabel":"stale-to","type":"INFO","body":"note"}""",
            metadata = mapOf("from" to "ses_a", "to" to "ses_b", "fromLabel" to "Explorer", "toLabel" to "Coordinator", "type" to "RESULT"),
        )
        val result = BoardToolParser.parse(tool)!!
        val message = result.messages.single()
        assertEquals("Explorer", message.fromLabel)
        assertEquals("Coordinator", message.toLabel)
        assertEquals("RESULT", message.type)
    }

    fun `test board_post surfaces the availability warning`() {
        val tool = tool(
            "board_post", ToolExecState.COMPLETED,
            output = """{"id":"m1","from":"main","to":"ses_a","type":"ASK","body":"ping",""" +
                """"warning":"The direct recipient's execution state was unknown at this post attempt."}""",
        )
        val result = BoardToolParser.parse(tool)!!
        assertEquals("The direct recipient's execution state was unknown at this post attempt.", result.warning)
    }

    fun `test board_post missing body returns null`() {
        val tool = tool("board_post", ToolExecState.COMPLETED, output = """{"from":"main","to":"ALL","type":"INFO"}""")
        assertNull(BoardToolParser.parse(tool))
    }

    fun `test board_post missing route field returns null`() {
        val tool = tool("board_post", ToolExecState.COMPLETED, output = """{"to":"ALL","type":"INFO","body":"hi"}""")
        assertNull(BoardToolParser.parse(tool))
    }

    // ------ board_read ------

    fun `test board_read parses multiple messages`() {
        val tool = tool(
            "board_read", ToolExecState.COMPLETED,
            output = """{"ownerSessionID":"ses_root","revision":3,"hasMore":false,"messages":[""" +
                """{"id":"m1","from":"main","to":"ALL","type":"INFO","body":"first"},""" +
                """{"id":"m2","from":"ses_a","to":"main","type":"RESULT","body":"second"}""" +
                """]}""",
        )
        val result = BoardToolParser.parse(tool)!!
        assertTrue(result.read)
        assertEquals(listOf("first", "second"), result.messages.map { it.body })
        assertEquals(listOf("main", "ses_a"), result.messages.map { it.from })
    }

    fun `test board_read empty board parses to an empty list, not null`() {
        val tool = tool(
            "board_read", ToolExecState.COMPLETED,
            output = """{"ownerSessionID":"ses_root","revision":0,"hasMore":false,"messages":[]}""",
        )
        val result = BoardToolParser.parse(tool)!!
        assertTrue(result.read)
        assertEquals(emptyList<BoardMessageView>(), result.messages)
    }

    fun `test board_read missing messages key returns null`() {
        val tool = tool("board_read", ToolExecState.COMPLETED, output = """{"ownerSessionID":"ses_root","revision":0}""")
        assertNull(BoardToolParser.parse(tool))
    }

    fun `test board_read one malformed row invalidates the whole read`() {
        val tool = tool(
            "board_read", ToolExecState.COMPLETED,
            output = """{"messages":[{"from":"main","to":"ALL","type":"INFO","body":"ok"},{"to":"ALL","type":"INFO"}]}""",
        )
        assertNull(BoardToolParser.parse(tool))
    }

    fun `test boardMarkdown renders route and body for a single message`() {
        val tool = tool(
            "board_post", ToolExecState.COMPLETED,
            output = """{"from":"main","to":"ALL","type":"INFO","body":"hello team"}""",
        )
        val markdown = boardMarkdown(BoardToolParser.parse(tool)!!)
        assertTrue(markdown.contains("INFO"))
        assertTrue(markdown.contains("main"))
        assertTrue(markdown.contains("ALL"))
        assertTrue(markdown.contains("hello team"))
    }

    fun `test boardMarkdown separates multiple messages`() {
        val tool = tool(
            "board_read", ToolExecState.COMPLETED,
            output = """{"messages":[""" +
                """{"from":"main","to":"ALL","type":"INFO","body":"first"},""" +
                """{"from":"ses_a","to":"main","type":"RESULT","body":"second"}""" +
                """]}""",
        )
        val markdown = boardMarkdown(BoardToolParser.parse(tool)!!)
        assertTrue(markdown.contains("first"))
        assertTrue(markdown.contains("second"))
        assertTrue(markdown.contains("---"))
    }

    fun `test boardMarkdown escapes markdown special characters in route labels`() {
        val tool = tool(
            "board_post", ToolExecState.COMPLETED,
            output = """{"from":"main","to":"ALL","fromLabel":"*bold* agent","type":"INFO","body":"hi"}""",
        )
        val markdown = boardMarkdown(BoardToolParser.parse(tool)!!)
        assertTrue(markdown.contains("\\*bold\\* agent"))
    }

    // ------ helpers ------

    private fun tool(
        name: String,
        state: ToolExecState,
        output: String? = null,
        metadata: Map<String, String> = emptyMap(),
    ): Tool = Tool("tp1", name, toolKind(name)).apply {
        this.state = state
        this.output = output
        this.metadata = metadata
    }
}
