package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.ToolRefDto
import kotlinx.coroutines.ExperimentalCoroutinesApi

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

    fun `test hidden controller applies question metadata without flushing transcript`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 250L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        hide(m)
        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")), flush = false)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        settle()

        assertModelEvents("""
            StateChanged AwaitingQuestion
        """, modelEvents)
        assertTrue(m.model.state is SessionState.AwaitingQuestion)
        assertNull(m.model.message("msg1"))

        show(m)
        settle()

        assertTrue(m.model.state is SessionState.AwaitingQuestion)
        assertNotNull(m.model.message("msg1"))
    }

    fun `test hidden controller applies session title metadata without show`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 250L)
        flush()

        hide(m)
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test", title = "Hidden title")), flush = false)
        settle()

        assertEquals("Hidden title", m.model.session?.title)
        assertNull(m.model.message("msg1"))
    }

    fun `test hidden controller consumes matching question reply metadata`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 250L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        hide(m)
        emit(ChatEventDto.QuestionAsked("ses_test", question("q1")), flush = false)
        emit(ChatEventDto.QuestionReplied("ses_test", "q1"), flush = false)
        settle()

        assertModelEvents("""
            StateChanged AwaitingQuestion
            StateChanged Busy
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

    fun `test text snapshot covered delta is not duplicated`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        flush()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "import")), flush = false)
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "import"), flush = false)
        settle()
        flush()

        assertModel(
            """
            assistant#msg1
            text#prt1:
              import
            """,
            m,
        )
    }

    fun `test pure text deltas preserve incidental overlap`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        flush()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "hel"))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "lo"))
        settle()
        flush()

        assertModel(
            """
            assistant#msg1
            text#prt1:
              hello
            """,
            m,
        )
    }

    fun `test pure text deltas preserve split closing fence`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        flush()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "```python\nprint(1)\n``"))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "`\n\nafter"))
        settle()
        flush()

        assertModel(
            """
            assistant#msg1
            text#prt1:
              ```python
              print(1)
              ```
              
              after
            """,
            m,
        )
    }

    fun `test text snapshot covered prefix is trimmed from merged delta`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        flush()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "import")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "import java")), flush = false)
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", " java.util.List;"), flush = false)
        settle()
        flush()

        assertModel(
            """
            assistant#msg1
            text#prt1:
              import java.util.List;
            """,
            m,
        )
    }

    fun `test repeated snapshots then lagging merged delta is not duplicated`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        flush()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "import")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "import java")))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "import java"), flush = false)
        settle()
        flush()

        assertModel(
            """
            assistant#msg1
            text#prt1:
              import java
            """,
            m,
        )
    }

    fun `test multi round snapshot delta interleave stays single copy`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        flush()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "```java\nimport")))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "import"))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "```java\nimport java")))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", " java"))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "```java\nimport java.util.List;\n")))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", ".util.List;\n"))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "```java\nimport java.util.List;\n\npublic class StreamBasics {\n}\n```")))
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "\npublic class StreamBasics {\n}\n```"))

        assertModel(
            """
            assistant#msg1
            text#prt1:
              ```java
              import java.util.List;
              
              public class StreamBasics {
              }
              ```
            """,
            m,
        )
    }

    fun `test per token snapshot plus delta interleave does not double text or code`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        flush()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))

        // Reproduces the streamed screenshot: for every token the backend sends a full
        // PartUpdated snapshot AND a matching incremental PartDelta. The old dedup doubled
        // each token ("ReadRead", "inputinput.txt.txt"); glue must keep a single copy.
        val tokens = listOf(
            "**Python**", "\n\n", "Read", " a", " file", " line", " by", " line", ",",
            " which", " is", " stream-like", " because", " it", " avoids", " loading",
            " the", " whole", " file", " into", " memory", ":", "\n\n",
            "```python\n", "with", " open", "(\"input.txt\",", " \"r\")", " as", " file:", "\n",
            "    for", " line", " in", " file:", "\n", "        print", "(line.strip())", "\n",
            "```",
        )
        val sb = StringBuilder()
        for (token in tokens) {
            sb.append(token)
            emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = sb.toString())))
            emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", token))
        }
        settle()
        flush()

        val text = (m.model.message("msg1")!!.parts["prt1"] as ai.kilocode.client.session.model.Text).content.toString()
        assertEquals(sb.toString(), text)
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

    @OptIn(ExperimentalCoroutinesApi::class)
    fun `test condensed and raw controller end with same final state on large corpus`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()

        val events = corpus()
        val a = snapshot(runCorpus(events, true))
        rpc.events.resetReplayCache()
        val b = snapshot(runCorpus(events, false))

        if (a != b) fail("condensed=\n$a\nraw=\n$b")
        assertEquals(SessionState.Idle, a.state)
        assertTrue(a.body.contains("assistant#msg1"))
        assertTrue(a.body.contains("assistant#msg2"))
        assertTrue(a.body.contains("diff: src/A.kt src/B.kt"))
        assertTrue(a.body.contains("todo: [completed] ship feature"))
        assertEquals(2, a.compacted)
    }

    fun `test update hooks run on EDT around queued model batch`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val order = mutableListOf<String>()
        lateinit var m: SessionController
        m = controller(
            id = "ses_test",
            flushMs = Long.MAX_VALUE,
            condense = true,
            beforeUpdate = {
                assertTrue(com.intellij.openapi.application.ApplicationManager.getApplication().isDispatchThread)
                order.add("before:${order.size}")
                true
            },
            afterUpdate = { follow ->
                assertTrue(com.intellij.openapi.application.ApplicationManager.getApplication().isDispatchThread)
                order.add("after:$follow:${order.size}")
            },
        )
        flush()
        order.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "text", text = "hello")), flush = false)
        settle()
        flush()

        assertEquals(listOf("before:0", "after:true:1"), order)
        assertNotNull(m.model.message("msg1")?.parts?.get("prt1"))
    }

    fun `test update hooks run on EDT around history and recovery`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        rpc.history.add(ai.kilocode.rpc.dto.MessageWithPartsDto(msg("msg1", "ses_test", "assistant"), emptyList()))
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("busy"))
        val order = mutableListOf<String>()
        val m = controller(
            id = "ses_test",
            flushMs = Long.MAX_VALUE,
            condense = true,
            beforeUpdate = {
                assertTrue(com.intellij.openapi.application.ApplicationManager.getApplication().isDispatchThread)
                order.add("before:${order.size}")
                true
            },
            afterUpdate = { follow ->
                assertTrue(com.intellij.openapi.application.ApplicationManager.getApplication().isDispatchThread)
                order.add("after:$follow:${order.size}")
            },
        )

        flush()

        assertTrue(order.contains("before:0"))
        assertTrue(order.contains("after:true:1"))
        assertTrue(order.contains("before:2"))
        assertTrue(order.contains("after:true:3"))
        assertNotNull(m.model.message("msg1"))
        assertTrue(m.model.state is SessionState.Busy)
    }

    private fun question(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(
            QuestionInfoDto(
                question = "Pick one",
                header = "Choice",
                options = listOf(QuestionOptionDto("A", "Option A")),
                multiple = false,
                custom = true,
            ),
        ),
        tool = ToolRefDto("msg1", "call1"),
    )

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
