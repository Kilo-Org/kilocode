package ai.kilocode.client.session.update

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.TodoDto

class SessionUpdateQueueTest : SessionControllerTestBase() {

    fun `test hidden controller buffers until shown`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 250L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        hide(m)
        emit(ChatEventDto.TurnOpen("ses_test"), flush = false)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        settle()

        assertTrue(modelEvents.isEmpty())
        assertEquals(SessionState.Idle, m.model.state)

        show(m)
        settle()

        assertModelEvents("""
            StateChanged Busy
            MessageAdded msg1
            TurnAdded msg1 [msg1]
        """, modelEvents)
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test hidden controller condenses while hidden but does not flush`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 250L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        hide(m)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        repeat(4) { i ->
            emit(ChatEventDto.PartDelta("ses_test", "msg1", "txt1", "text", " chunk$i"), flush = false)
        }
        emit(ChatEventDto.PartUpdated("ses_test", part("tool1", "ses_test", "msg1", "tool", tool = "bash", state = "running")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("tool1", "ses_test", "msg1", "tool", tool = "bash", state = "completed", title = "Run build")), flush = false)
        settle()

        assertTrue(modelEvents.isEmpty())
        assertEquals(SessionState.Idle, m.model.state)

        show(m)
        settle()

        assertModelEvents("""
            MessageAdded msg1
            TurnAdded msg1 [msg1]
            ContentAdded msg1/txt1
            ContentDelta msg1/txt1
            ContentAdded msg1/tool1
        """, modelEvents)
        assertModel(
            """
            assistant#msg1
            text#txt1:
               chunk0 chunk1 chunk2 chunk3
            tool#tool1 bash [COMPLETED] Run build
            """,
            m,
        )
    }

    fun `test hidden cadence does not flush until shown`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 50L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        hide(m)
        emit(ChatEventDto.TurnOpen("ses_test"), flush = false)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        settle()

        assertTrue(modelEvents.isEmpty())
        assertEquals(SessionState.Idle, m.model.state)

        show(m)
        settle()

        assertModelEvents("""
            StateChanged Busy
            MessageAdded msg1
            TurnAdded msg1 [msg1]
        """, modelEvents)
    }

    fun `test hidden controller flushes on show without new event`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 250L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        hide(m)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "txt1", "text", "hello "), flush = false)
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "txt1", "text", "world"), flush = false)
        settle()

        assertTrue(modelEvents.isEmpty())

        show(m)
        settle()

        assertModelEvents("""
            MessageAdded msg1
            TurnAdded msg1 [msg1]
            ContentAdded msg1/txt1
            ContentDelta msg1/txt1
        """, modelEvents)
        assertModel(
            """
            assistant#msg1
            text#txt1:
              hello world
            """,
            m,
        )
    }

    fun `test buffered deltas coalesce into one model delta`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "hello "), flush = false)
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "world"), flush = false)
        settle()
        flush()

        assertEquals(1, modelEvents.count { it is SessionModelEvent.ContentAdded })
        val delta = modelEvents.filterIsInstance<SessionModelEvent.ContentDelta>()
        assertEquals(1, delta.size)
        assertModel(
            """
            assistant#msg1
            text#prt1:
              hello world
            """,
            m,
        )
        assertEquals(listOf("hello world"), delta.map { it.delta })
    }

    fun `test visible controller flushes after cadence`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 50L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.TurnOpen("ses_test"), flush = false)
        flush()

        assertTrue(modelEvents.any { it is SessionModelEvent.StateChanged })
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test buffered part updates for new part collapse to one content add`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "pending")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "completed")), flush = false)
        settle()
        flush()

        assertEquals(1, modelEvents.count { it is SessionModelEvent.ContentAdded })
        assertEquals(0, modelEvents.count { it is SessionModelEvent.ContentUpdated })
        val tool = m.model.message("msg1")!!.parts["prt1"] as Tool
        assertEquals(ToolExecState.COMPLETED, tool.state)
    }

    fun `test buffered part updates for existing part collapse to one content update`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "pending")))
        modelEvents.clear()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "running")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "completed", title = "Install deps")), flush = false)
        settle()
        flush()

        assertEquals(0, modelEvents.count { it is SessionModelEvent.ContentAdded })
        assertEquals(1, modelEvents.count { it is SessionModelEvent.ContentUpdated })
        val tool = m.model.message("msg1")!!.parts["prt1"] as Tool
        assertEquals(ToolExecState.COMPLETED, tool.state)
        assertEquals("Install deps", tool.title)
    }

    fun `test buffered same part tool updates keep only final busy text`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "read", state = "running")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "running")), flush = false)
        settle()
        flush()

        val busy = modelEvents.filterIsInstance<SessionModelEvent.StateChanged>()
            .filter { it.state is SessionState.Busy }
        assertEquals(1, busy.size)
        val state = busy.single().state as SessionState.Busy
        assertTrue(state.text.contains("commands", ignoreCase = true))
    }

    fun `test barrier prevents part update merge across turn close`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.TurnOpen("ses_test"))
        modelEvents.clear()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "running")), flush = false)
        emit(ChatEventDto.TurnClose("ses_test", "completed"), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "completed")), flush = false)
        settle()
        flush()

        assertModelEvents("""
            ContentAdded msg1/prt1
            StateChanged Busy
            StateChanged Idle
            ContentUpdated msg1/prt1
        """, modelEvents)
        assertEquals(SessionState.Idle, m.model.state)
    }

    fun `test condensed and raw controller end with same final state on large corpus`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()

        val events = corpus()
        val condensed = runCorpus(events, true)
        val raw = runCorpus(events, false)
        val a = snapshot(condensed)
        val b = snapshot(raw)

        if (a != b) fail("condensed=\n$a\nraw=\n$b")
        assertEquals(SessionState.Idle, a.state)
        assertTrue(a.body.contains("assistant#msg1"))
        assertTrue(a.body.contains("assistant#msg2"))
        assertTrue(a.body.contains("diff: src/A.kt src/B.kt"))
        assertTrue(a.body.contains("todo: [completed] ship feature"))
        assertEquals(4, a.compacted)
    }

    private fun corpus(): List<ChatEventDto> = buildList {
        add(ChatEventDto.TurnOpen("ses_test"))
        add(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        add(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant").copy(cost = 0.01)))
        add(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant").copy(cost = 0.02)))
        add(ChatEventDto.PartUpdated("ses_test", part("tool1", "ses_test", "msg1", "tool", tool = "read", state = "running")))
        add(ChatEventDto.PartUpdated("ses_test", part("tool1", "ses_test", "msg1", "tool", tool = "read", state = "running", title = "Read files")))
        add(ChatEventDto.PartUpdated("ses_test", part("tool1", "ses_test", "msg1", "tool", tool = "read", state = "completed", title = "Read files")))
        add(ChatEventDto.PartUpdated("ses_test", part("snap1", "ses_test", "msg1", "text", text = "he")))
        repeat(8) { i ->
            add(ChatEventDto.PartDelta("ses_test", "msg1", "txt1", "text", " chunk$i"))
        }
        add(ChatEventDto.PartUpdated("ses_test", part("snap1", "ses_test", "msg1", "text", text = "hello")))
        add(ChatEventDto.SessionStatusChanged("ses_test", SessionStatusDto("busy")))
        add(ChatEventDto.SessionStatusChanged("ses_test", SessionStatusDto("retry", message = "retrying", attempt = 2, next = 10L)))
        add(ChatEventDto.SessionStatusChanged("ses_test", SessionStatusDto("offline", message = "offline", requestID = "req1")))
        add(ChatEventDto.SessionStatusChanged("ses_test", SessionStatusDto("idle")))
        add(ChatEventDto.SessionDiffChanged("ses_test", listOf(DiffFileDto("src/A.kt", 1, 0))))
        add(ChatEventDto.SessionDiffChanged("ses_test", emptyList()))
        add(ChatEventDto.SessionDiffChanged("ses_test", listOf(DiffFileDto("src/A.kt", 2, 1), DiffFileDto("src/B.kt", 4, 0))))
        add(ChatEventDto.TodoUpdated("ses_test", listOf(TodoDto("draft plan", "in_progress", "high"))))
        add(ChatEventDto.TodoUpdated("ses_test", listOf(TodoDto("ship feature", "completed", "high"))))
        add(ChatEventDto.SessionCompacted("ses_test"))
        add(ChatEventDto.MessageUpdated("ses_test", msg("msg2", "ses_test", "assistant")))
        add(ChatEventDto.MessageUpdated("ses_test", msg("msg2", "ses_test", "assistant").copy(cost = 0.02)))
        add(ChatEventDto.PartUpdated("ses_test", part("tool2", "ses_test", "msg2", "tool", tool = "edit", state = "running")))
        add(ChatEventDto.PartUpdated("ses_test", part("tool2", "ses_test", "msg2", "tool", tool = "edit", state = "completed", title = "Patch file")))
        repeat(6) { i ->
            add(ChatEventDto.PartDelta("ses_test", "msg2", "txt2", "text", " body$i"))
        }
        add(ChatEventDto.TurnClose("ses_test", "completed"))
        add(ChatEventDto.TurnOpen("ses_test"))
        add(ChatEventDto.MessageUpdated("ses_test", msg("msg3", "ses_test", "assistant")))
        add(ChatEventDto.MessageUpdated("ses_test", msg("msg3", "ses_test", "assistant").copy(cost = 0.03)))
        add(ChatEventDto.PartUpdated("ses_test", part("tail", "ses_test", "msg3", "text", text = "tail start")))
        repeat(5) { i ->
            add(ChatEventDto.PartDelta("ses_test", "msg3", "tail", "text", " extra$i"))
        }
        add(ChatEventDto.SessionCompacted("ses_test"))
        add(ChatEventDto.SessionIdle("ses_test"))
    }

    private fun runCorpus(events: List<ChatEventDto>, condense: Boolean): SessionController {
        val m = controller("ses_test", flushMs = Long.MAX_VALUE, condense = condense)
        flush()
        for (event in events) emit(event, flush = false)
        settle()
        flush()
        return m
    }
}
