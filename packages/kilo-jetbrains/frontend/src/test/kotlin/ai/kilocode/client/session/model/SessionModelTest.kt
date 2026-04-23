package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.TodoDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.UsefulTestCase

class SessionModelTest : UsefulTestCase() {

    private lateinit var model: SessionModel
    private lateinit var parent: Disposable
    private lateinit var events: MutableList<SessionModelEvent>

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("test")
        model = SessionModel()
        events = mutableListOf()
        model.addListener(parent) { events.add(it) }
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
        } finally {
            super.tearDown()
        }
    }

    fun `test initial app and workspace state`() {
        assertEquals(KiloAppStatusDto.DISCONNECTED, model.app.status)
        assertEquals(KiloWorkspaceStatusDto.PENDING, model.workspace.status)
        assertFalse(model.isReady())
        assertEquals(SessionState.Idle, model.state)
    }

    fun `test isReady requires app and workspace readiness`() {
        model.app = KiloAppStateDto(KiloAppStatusDto.READY)
        assertFalse(model.isReady())

        model.workspace = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        assertTrue(model.isReady())
    }

    fun `test addMessage stores entry and fires MessageAdded then TurnAdded`() {
        model.addMessage(msg("m1", "user"))

        val item = model.message("m1")
        assertNotNull(item)
        // MessageAdded then TurnAdded (regroup fires immediately after)
        assertEquals(2, events.size)
        val event = events[0] as SessionModelEvent.MessageAdded
        assertEquals("m1", event.info.info.id)
        assertTrue(events[1] is SessionModelEvent.TurnAdded)
    }

    fun `test addMessage duplicate is ignored`() {
        model.addMessage(msg("m1", "user"))
        events.clear()

        model.addMessage(msg("m1", "user"))

        assertEquals(1, model.messages().size)
        assertTrue(events.isEmpty())
    }

    fun `test removeMessage removes entry and fires MessageRemoved then TurnRemoved`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.removeMessage("m1")

        assertNull(model.message("m1"))
        // MessageRemoved + TurnRemoved after regroup
        assertEquals(2, events.size)
        assertEquals("m1", (events[0] as SessionModelEvent.MessageRemoved).id)
        assertEquals("m1", (events[1] as SessionModelEvent.TurnRemoved).id)
    }

    fun `test removeMessage unknown id is noop`() {
        model.removeMessage("unknown")
        assertTrue(events.isEmpty())
    }

    fun `test updateContent text creates Text content and fires ContentAdded`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "text", text = "hello"))

        val p = model.message("m1")!!.parts["p1"]
        assertTrue(p is Text)
        assertEquals("hello", (p as Text).content.toString())
        val event = events.single() as SessionModelEvent.ContentAdded
        assertEquals("m1", event.messageId)
    }

    fun `test updateContent text replaces content and fires ContentUpdated`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "text", text = "old"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "text", text = "new"))

        assertEquals("new", (model.message("m1")!!.parts["p1"] as Text).content.toString())
        assertTrue(events.single() is SessionModelEvent.ContentUpdated)
    }

    fun `test updateContent reasoning creates Reasoning content`() {
        model.addMessage(msg("m1", "assistant"))

        model.updateContent("m1", part("p1", "m1", "reasoning", text = "thinking"))

        val p = model.message("m1")!!.parts["p1"]
        assertTrue(p is Reasoning)
        assertEquals("thinking", (p as Reasoning).content.toString())
    }

    fun `test updateContent tool creates Tool content and tracks state`() {
        model.addMessage(msg("m1", "assistant"))

        model.updateContent("m1", part("p1", "m1", "tool", tool = "bash", state = "running", title = "ls"))

        val p = model.message("m1")!!.parts["p1"] as Tool
        assertEquals("bash", p.name)
        assertEquals(ToolExecState.RUNNING, p.state)
        assertEquals("ls", p.title)
    }

    fun `test updateContent tool updates lifecycle`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "tool", tool = "bash", state = "pending"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "tool", tool = "bash", state = "completed"))

        val p = model.message("m1")!!.parts["p1"] as Tool
        assertEquals(ToolExecState.COMPLETED, p.state)
        assertTrue(events.single() is SessionModelEvent.ContentUpdated)
    }

    fun `test updateContent compaction creates Compaction content`() {
        model.addMessage(msg("m1", "assistant"))

        model.updateContent("m1", part("p1", "m1", "compaction"))

        assertTrue(model.message("m1")!!.parts["p1"] is Compaction)
    }

    fun `test updateContent silently drops step-start parts`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "step-start"))

        assertNull(model.message("m1")!!.parts["p1"])
        assertTrue(events.isEmpty())
    }

    fun `test updateContent silently drops step-finish parts`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "step-finish"))

        assertNull(model.message("m1")!!.parts["p1"])
        assertTrue(events.isEmpty())
    }

    fun `test updateContent unknown type stored as Generic`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "snapshot"))

        val p = model.message("m1")!!.parts["p1"]
        assertTrue("Expected Generic fallback but got: ${p?.javaClass?.simpleName}", p is Generic)
        assertEquals("snapshot", (p as Generic).type)
        assertTrue(events.single() is SessionModelEvent.ContentAdded)
    }

    fun `test appendDelta appends to existing text content`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "text", text = "hello "))
        events.clear()

        model.appendDelta("m1", "p1", "world")

        assertEquals("hello world", (model.message("m1")!!.parts["p1"] as Text).content.toString())
        val event = events.single() as SessionModelEvent.ContentDelta
        assertEquals("p1", event.contentId)
        assertEquals("world", event.delta)
    }

    fun `test appendDelta appends to reasoning content`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "reasoning", text = "hmm "))
        events.clear()

        model.appendDelta("m1", "p1", "interesting")

        assertEquals("hmm interesting", (model.message("m1")!!.parts["p1"] as Reasoning).content.toString())
    }

    fun `test appendDelta creates text content if missing`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.appendDelta("m1", "p1", "first")

        val p = model.message("m1")!!.parts["p1"]
        assertTrue(p is Text)
        assertEquals("first", (p as Text).content.toString())
        assertEquals(2, events.size)
        assertTrue(events[0] is SessionModelEvent.ContentAdded)
        assertTrue(events[1] is SessionModelEvent.ContentDelta)
    }

    fun `test appendDelta on tool content is noop`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "tool", tool = "bash", state = "running"))
        events.clear()

        model.appendDelta("m1", "p1", "text")

        assertTrue(events.isEmpty())
    }

    fun `test setState stores state and fires StateChanged`() {
        val state = SessionState.Busy("thinking")
        model.setState(state)

        assertEquals(state, model.state)
        assertEquals(state, (events.single() as SessionModelEvent.StateChanged).state)
    }

    fun `test setState to Error stores error data`() {
        model.setState(SessionState.Error("something broke", "timeout"))

        val state = model.state as SessionState.Error
        assertEquals("something broke", state.message)
        assertEquals("timeout", state.kind)
    }

    fun `test setState to AwaitingQuestion stores question`() {
        val q = question("q1")
        model.setState(SessionState.AwaitingQuestion(q))

        assertModel(
            """
            question#q1
            tool: <none>
            header: Pick
            prompt: Which option?
            option: A - Option A
            option: B - Option B
            multiple: false
            custom: true
            """,
        )
    }

    fun `test setState to AwaitingPermission stores permission`() {
        val p = permission("p1")
        model.setState(SessionState.AwaitingPermission(p))

        assertModel(
            """
            permission#p1
            tool: <none>
            name: edit
            patterns: *.kt
            always: <none>
            file: <none>
            state: PENDING
            metadata: <none>
            """,
        )
    }

    fun `test question tool ref is stored in awaiting question state`() {
        val q = Question(
            id = "q1",
            items = listOf(QuestionItem("Pick one", "Choice", listOf(QuestionOption("A", "Option A")), false, true)),
            tool = ToolCallRef("msg1", "call1"),
        )

        model.setState(SessionState.AwaitingQuestion(q))

        assertModel(
            """
            question#q1
            tool: msg1/call1
            header: Choice
            prompt: Pick one
            option: A - Option A
            multiple: false
            custom: true
            """,
        )
    }

    fun `test permission fields are preserved in awaiting permission state`() {
        val p = Permission(
            id = "p1",
            sessionId = "ses",
            name = "edit",
            patterns = listOf("*.kt"),
            always = listOf("src/**"),
            meta = PermissionMeta(
                rules = listOf("src/**"),
                diff = "patch",
                filePath = "src/A.kt",
                fileDiff = PermissionFileDiff("src/A.kt", additions = 2, deletions = 1),
                raw = mapOf("kind" to "edit"),
            ),
            message = "Allow edit?",
            tool = ToolCallRef("msg1", "call1"),
            state = PermissionRequestState.RESPONDING,
        )

        model.setState(SessionState.AwaitingPermission(p))

        assertModel(
            """
            permission#p1
            tool: msg1/call1
            name: edit
            patterns: *.kt
            always: src/**
            file: src/A.kt
            state: RESPONDING
            metadata: kind=edit
            """,
        )
    }

    fun `test loadHistory populates typed contents and fires HistoryLoaded`() {
        model.addMessage(msg("old", "user"))
        events.clear()

        val text = PartDto(id = "p1", sessionID = "s1", messageID = "m1", type = "text", text = "hello")
        val tool = PartDto(id = "p2", sessionID = "s1", messageID = "m1", type = "tool", tool = "bash", state = "completed", title = "ls")

        model.loadHistory(listOf(MessageWithPartsDto(msg("m1", "assistant"), listOf(text, tool))))

        assertNull(model.message("old"))
        val entry = model.message("m1")!!
        assertTrue(entry.parts["p1"] is Text)
        assertEquals("hello", (entry.parts["p1"] as Text).content.toString())
        assertTrue(entry.parts["p2"] is Tool)
        assertEquals(ToolExecState.COMPLETED, (entry.parts["p2"] as Tool).state)
        assertTrue(events.single() is SessionModelEvent.HistoryLoaded)
    }

    fun `test loadHistory stores unknown content types as Generic`() {
        val text = PartDto(id = "p1", sessionID = "s1", messageID = "m1", type = "text", text = "visible")
        val snapshot = PartDto(id = "p2", sessionID = "s1", messageID = "m1", type = "snapshot")

        model.loadHistory(listOf(MessageWithPartsDto(msg("m1", "assistant"), listOf(text, snapshot))))

        val entry = model.message("m1")!!
        assertTrue(entry.parts.containsKey("p1"))
        assertTrue(entry.parts.containsKey("p2"))
        assertTrue(entry.parts["p2"] is Generic)
        assertEquals("snapshot", (entry.parts["p2"] as Generic).type)
    }

    fun `test loadHistory silently drops step-start and step-finish parts`() {
        val text = PartDto(id = "p1", sessionID = "s1", messageID = "m1", type = "text", text = "visible")
        val stepStart = PartDto(id = "p2", sessionID = "s1", messageID = "m1", type = "step-start")
        val stepFinish = PartDto(id = "p3", sessionID = "s1", messageID = "m1", type = "step-finish")

        model.loadHistory(listOf(MessageWithPartsDto(msg("m1", "assistant"), listOf(text, stepStart, stepFinish))))

        val entry = model.message("m1")!!
        assertEquals(listOf("p1"), entry.parts.keys.toList())
    }

    fun `test upsertMessage adds new message and returns true`() {
        val added = model.upsertMessage(msg("m1", "user"))

        assertTrue(added)
        assertNotNull(model.message("m1"))
        // upsertMessage fires MessageAdded then TurnAdded
        assertEquals(2, events.size)
        val event = events.filterIsInstance<SessionModelEvent.MessageAdded>().single()
        assertEquals("m1", event.info.info.id)
        assertTrue(events.any { it is SessionModelEvent.TurnAdded })
    }

    fun `test upsertMessage updates existing message and returns false`() {
        model.upsertMessage(msg("m1", "user"))
        events.clear()

        val updated = msg("m1", "assistant") // same id, different role (simulating metadata update)
        val added = model.upsertMessage(updated)

        assertFalse(added)
        assertEquals("assistant", model.message("m1")!!.info.role)
        val event = events.single() as SessionModelEvent.MessageUpdated
        assertEquals("m1", event.info.info.id)
    }

    fun `test upsertMessage update preserves existing parts`() {
        model.upsertMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "text", text = "hello"))
        events.clear()

        model.upsertMessage(msg("m1", "assistant"))

        assertNotNull(model.message("m1")!!.parts["p1"])
    }

    fun `test removeContent fires ContentRemoved`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "text", text = "hello"))
        events.clear()

        model.removeContent("m1", "p1")

        assertNull(model.message("m1")!!.parts["p1"])
        val event = events.single() as SessionModelEvent.ContentRemoved
        assertEquals("m1", event.messageId)
        assertEquals("p1", event.contentId)
    }

    fun `test removeContent unknown messageId is noop`() {
        events.clear()
        model.removeContent("missing", "p1")
        assertTrue(events.isEmpty())
    }

    fun `test removeContent unknown contentId is noop`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()
        model.removeContent("m1", "missing_part")
        assertTrue(events.isEmpty())
    }

    fun `test setDiff stores diff and fires DiffUpdated`() {
        model.setDiff(listOf(
            DiffFileDto("src/A.kt", additions = 3, deletions = 1),
            DiffFileDto("src/B.kt", additions = 0, deletions = 2),
        ))

        assertModel("diff: src/A.kt src/B.kt")
        assertEquals("DiffUpdated files=2", events.single().toString())
    }

    fun `test setDiff with empty list clears diff`() {
        model.setDiff(listOf(DiffFileDto("src/A.kt", additions = 1, deletions = 0)))
        events.clear()

        model.setDiff(emptyList())

        assertModel("")
        assertEquals("DiffUpdated files=0", events.single().toString())
    }

    fun `test setTodos stores todos and fires TodosUpdated`() {
        model.setTodos(listOf(
            TodoDto("Write tests", "pending", "high"),
            TodoDto("Ship it", "in_progress", "medium"),
        ))

        assertModel("""
            todo: [pending] Write tests
            todo: [in_progress] Ship it
        """)
        assertEquals("TodosUpdated count=2", events.single().toString())
    }

    fun `test setTodos with empty list clears todos`() {
        model.setTodos(listOf(TodoDto("old task", "completed", "low")))
        events.clear()

        model.setTodos(emptyList())

        assertModel("")
        assertEquals("TodosUpdated count=0", events.single().toString())
    }

    fun `test markCompacted increments count and fires Compacted`() {
        model.markCompacted()

        assertModel("compacted: 1")
        assertEquals("Compacted count=1", events.single().toString())
    }

    fun `test markCompacted accumulates across multiple calls`() {
        model.markCompacted()
        model.markCompacted()
        model.markCompacted()

        assertModel("compacted: 3")
        assertEquals("Compacted count=3", events.last().toString())
    }

    fun `test clear resets diff todos and compactionCount`() {
        model.setDiff(listOf(DiffFileDto("a.kt", 1, 0)))
        model.setTodos(listOf(TodoDto("task", "pending", "high")))
        model.markCompacted()
        events.clear()

        model.clear()

        assertModel("")
        assertTrue(events.single() is SessionModelEvent.Cleared)
    }

    fun `test loadHistory resets diff todos and compactionCount`() {
        model.setDiff(listOf(DiffFileDto("a.kt", 1, 0)))
        model.setTodos(listOf(TodoDto("task", "pending", "high")))
        model.markCompacted()
        events.clear()

        model.loadHistory(emptyList())

        assertModel("")
        assertTrue(events.single() is SessionModelEvent.HistoryLoaded)
    }

    fun `test clear resets messages and state`() {
        model.addMessage(msg("m1", "user"))
        model.setState(SessionState.Busy("busy"))
        model.app = KiloAppStateDto(KiloAppStatusDto.READY)
        model.workspace = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        events.clear()

        model.clear()

        assertTrue(model.isEmpty())
        assertEquals(SessionState.Idle, model.state)
        assertTrue(events.single() is SessionModelEvent.Cleared)
    }

    fun `test listener auto removed on dispose`() {
        val child = Disposer.newDisposable("child")
        Disposer.register(parent, child)

        val extra = mutableListOf<SessionModelEvent>()
        model.addListener(child) { extra.add(it) }

        model.addMessage(msg("m1", "user"))
        assertEquals(2, extra.size)  // MessageAdded + TurnAdded

        Disposer.dispose(child)
        extra.clear()

        model.addMessage(msg("m2", "user"))
        assertTrue(extra.isEmpty())
    }

    private fun msg(id: String, role: String) = MessageDto(
        id = id,
        sessionID = "ses",
        role = role,
        time = MessageTimeDto(created = 0.0),
    )

    private fun part(
        id: String,
        mid: String,
        type: String,
        text: String? = null,
        tool: String? = null,
        state: String? = null,
        title: String? = null,
    ) = PartDto(
        id = id,
        sessionID = "ses",
        messageID = mid,
        type = type,
        text = text,
        tool = tool,
        state = state,
        title = title,
    )

    private fun question(id: String) = Question(
        id = id,
        items = listOf(
            QuestionItem(
                question = "Which option?",
                header = "Pick",
                options = listOf(QuestionOption("A", "Option A"), QuestionOption("B", "Option B")),
                multiple = false,
                custom = true,
            ),
        ),
    )

    private fun permission(id: String) = Permission(
        id = id,
        sessionId = "ses",
        name = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
        meta = PermissionMeta(),
    )

    private fun assertModel(expected: String) {
        assertEquals(expected.trimIndent().trim(), model.toString().trim())
    }
}
