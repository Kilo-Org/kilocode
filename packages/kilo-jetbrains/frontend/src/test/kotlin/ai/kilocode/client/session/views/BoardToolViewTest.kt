package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.tool.BoardToolView
import ai.kilocode.client.session.views.tool.ToolView
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class BoardToolViewTest : BasePlatformTestCase() {
    private val views = mutableListOf<BoardToolView>()

    override fun tearDown() {
        try {
            views.forEach(Disposer::dispose)
            views.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test board_post title comes from the CLI-supplied tool title`() {
        val view = track(BoardToolView(post().also { it.title = "INFO to ALL" }))

        assertTrue(view.labelText().contains("INFO to ALL"))
    }

    fun `test board_read subtitle shows message count`() {
        val view = track(BoardToolView(read(messages = 2)))

        assertTrue(view.labelText().contains("2"))
    }

    fun `test board_post subtitle is empty`() {
        val view = track(BoardToolView(post()))

        assertFalse(view.labelText().contains("null"))
    }

    fun `test completed board post starts collapsed and expands to markdown body`() {
        val view = track(BoardToolView(post()))

        assertTrue(view.hasToggle())
        assertFalse(view.isExpanded())
        assertFalse(view.bodyVisible())

        view.toggle()

        assertTrue(view.isExpanded())
        assertTrue(view.bodyVisible())
        assertTrue(view.markdown().contains("status update"))
    }

    fun `test board body is lazy and reused across collapse cycles`() {
        val view = track(BoardToolView(post()))

        assertFalse(view.bodyCreated())
        view.toggle()
        assertTrue(view.bodyCreated())
        val body = view.markdown()

        view.toggle()
        assertFalse(view.bodyVisible())
        view.toggle()

        assertEquals(body, view.markdown())
        assertTrue(view.bodyVisible())
    }

    fun `test update refreshes markdown body while expanded`() {
        val view = track(BoardToolView(post()))
        view.toggle()

        view.update(post(body = "revised body"))

        assertTrue(view.markdown().contains("revised body"))
    }

    fun `test view factory routes completed board_post to board tool view`() {
        assertTrue(ViewFactory.create(post(), openFile = { _, _ -> }) is BoardToolView)
    }

    fun `test view factory falls back to generic tool view while board_post is running`() {
        val running = post().also { it.state = ToolExecState.RUNNING; it.output = null }
        assertTrue(ViewFactory.create(running, openFile = { _, _ -> }) is ToolView)
    }

    fun `test view factory falls back to generic tool view for malformed output`() {
        val malformed = post().also { it.output = "not json" }
        assertTrue(ViewFactory.create(malformed, openFile = { _, _ -> }) is ToolView)
    }

    fun `test should replace when board renderer changes`() {
        val running = post().also { it.state = ToolExecState.RUNNING; it.output = null }
        val completed = post()

        assertTrue(ViewFactory.shouldReplace(ToolView(running), completed))
        assertFalse(ViewFactory.shouldReplace(BoardToolView(completed), completed))
    }

    private fun post(body: String = "status update") = Tool("p1", "board_post", toolKind("board_post")).also {
        it.state = ToolExecState.COMPLETED
        it.title = "INFO to ALL"
        it.output = """{"id":"m1","from":"main","to":"ALL","type":"INFO","body":"$body"}"""
    }

    private fun read(messages: Int) = Tool("p1", "board_read", toolKind("board_read")).also {
        it.state = ToolExecState.COMPLETED
        it.title = "Shared agent board"
        val rows = (1..messages).joinToString(",") { n ->
            """{"id":"m$n","from":"main","to":"ALL","type":"INFO","body":"note $n"}"""
        }
        it.output = """{"ownerSessionID":"ses_root","revision":1,"hasMore":false,"messages":[$rows]}"""
    }

    private fun track(view: BoardToolView): BoardToolView {
        views.add(view)
        return view
    }
}
