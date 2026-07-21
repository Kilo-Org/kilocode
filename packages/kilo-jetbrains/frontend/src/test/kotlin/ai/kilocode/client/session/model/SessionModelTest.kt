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
import ai.kilocode.rpc.dto.PartSourceDto
import ai.kilocode.rpc.dto.PartSourceTextDto
import ai.kilocode.rpc.dto.PartTimeDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionRevertDto
import ai.kilocode.rpc.dto.SessionTimeDto
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TodoViewDto
import ai.kilocode.rpc.dto.TokensDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class SessionModelTest : BasePlatformTestCase() {

    private lateinit var model: SessionModel
    private lateinit var parent: Disposable
    private lateinit var events: MutableList<SessionModelEvent>

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("test")
        model = SessionModel()
        events = mutableListOf()
        model.addListener(parent) {
            if (it !is SessionModelEvent.HeaderUpdated) events.add(it)
        }
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

    fun `test model mutation works through EDT`() {
        // The test fixture does not consistently throw for @RequiresEdt when called
        // from a pooled thread, so keep this as a behavioral EDT contract check.
        edt { model.addMessage(msg("on_edt", "assistant")) }

        assertNotNull(edt { model.message("on_edt") })
        assertTrue(events.any { it is SessionModelEvent.MessageAdded && it.info.info.id == "on_edt" })
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

    fun `test reverted count includes user messages from marker`() {
        model.addMessage(msg("u1", "user"))
        model.addMessage(msg("a1", "assistant"))
        model.addMessage(msg("u2", "user"))
        model.addMessage(msg("a2", "assistant"))

        model.setRevert(SessionRevertDto("u1"))
        assertEquals(2, model.revertedCount())

        model.setRevert(SessionRevertDto("u2"))
        assertEquals(1, model.revertedCount())

        model.setRevert(SessionRevertDto("missing"))
        assertEquals(0, model.revertedCount())
    }

    fun `test isRevertedMessage matches marker and later messages`() {
        model.addMessage(msg("u1", "user"))
        model.addMessage(msg("a1", "assistant"))
        model.addMessage(msg("u2", "user"))
        model.addMessage(msg("a2", "assistant"))

        model.setRevert(SessionRevertDto("u2"))

        assertFalse(model.isRevertedMessage("u1"))
        assertFalse(model.isRevertedMessage("a1"))
        assertTrue(model.isRevertedMessage("u2"))
        assertTrue(model.isRevertedMessage("a2"))
    }

    fun `test snapshotless revert still counts reverted messages`() {
        model.addMessage(msg("u1", "user"))
        model.addMessage(msg("a1", "assistant"))

        model.setRevert(SessionRevertDto("u1", snapshot = null))

        assertEquals(1, model.revertedCount())
        assertTrue(model.isRevertedMessage("u1"))
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

    fun `test updateContent ignores new empty text content`() {
        model.addMessage(msg("m1", "user"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "text", text = "   "))

        assertNull(model.message("m1")!!.parts["p1"])
        assertTrue(events.isEmpty())
    }

    fun `test updateContent removes existing text when it becomes empty`() {
        model.addMessage(msg("m1", "user"))
        model.updateContent("m1", part("p1", "m1", "text", text = "visible"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "text", text = ""))

        assertNull(model.message("m1")!!.parts["p1"])
        assertEquals("ContentRemoved m1/p1", events.single().toString())
    }

    fun `test updateContent skips user synthetic text`() {
        model.addMessage(msg("m1", "user"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "text", text = "raw content", synthetic = true))

        assertNull(model.message("m1")!!.parts["p1"])
        assertTrue(events.isEmpty())
    }

    fun `test updateContent removes existing user text when marked synthetic`() {
        model.addMessage(msg("m1", "user"))
        model.updateContent("m1", part("p1", "m1", "text", text = "visible"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "text", text = "hidden", synthetic = true))

        assertNull(model.message("m1")!!.parts["p1"])
        assertEquals("ContentRemoved m1/p1", events.single().toString())
    }

    fun `test assistant synthetic text remains visible`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "text", text = "visible", synthetic = true))

        assertEquals("visible", (model.message("m1")!!.parts["p1"] as Text).content.toString())
        assertEquals("ContentAdded m1/p1", events.single().toString())
    }

    fun `test updateContent non synthetic text unhides previous synthetic user text`() {
        model.addMessage(msg("m1", "user"))
        model.updateContent("m1", part("p1", "m1", "text", text = "hidden", synthetic = true))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "text", text = "visible now"))

        assertModel("""
            user#m1
            text#p1:
              visible now
        """)
        assertEquals("ContentAdded m1/p1", events.single().toString())
    }

    fun `test removeMessage clears hiddenText so a later non-synthetic part renders`() {
        model.addMessage(msg("m1", "user"))
        model.updateContent("m1", part("p1", "m1", "text", text = "hidden", synthetic = true))

        model.removeMessage("m1")
        events.clear()

        model.addMessage(msg("m1", "user"))
        model.updateContent("m1", part("p1", "m1", "text", text = "visible now"))

        assertModel("""
            user#m1
            text#p1:
              visible now
        """)
        assertEquals("ContentAdded m1/p1", events.last().toString())
    }

    fun `test clear resets hiddenText so a later non-synthetic part renders`() {
        model.addMessage(msg("m1", "user"))
        model.updateContent("m1", part("p1", "m1", "text", text = "hidden", synthetic = true))

        model.clear()
        events.clear()

        model.addMessage(msg("m1", "user"))
        model.updateContent("m1", part("p1", "m1", "text", text = "visible now"))

        assertModel("""
            user#m1
            text#p1:
              visible now
        """)
        assertEquals("ContentAdded m1/p1", events.last().toString())
    }

    fun `test updateContent reasoning creates Reasoning content`() {
        model.addMessage(msg("m1", "assistant"))

        model.updateContent("m1", part("p1", "m1", "reasoning", text = "thinking"))

        val p = model.message("m1")!!.parts["p1"]
        assertTrue(p is Reasoning)
        assertEquals("thinking", (p as Reasoning).content.toString())
        assertTrue(p.done)
    }

    fun `test updateContent reasoning tracks done state`() {
        model.addMessage(msg("m1", "assistant"))

        model.updateContent("m1", part("p1", "m1", "reasoning", text = "thinking", time = PartTimeDto(1.0, 2.0)))

        val p = model.message("m1")!!.parts["p1"] as Reasoning
        assertTrue(p.done)
    }

    fun `test updateContent file creates attachment content and updates metadata`() {
        model.addMessage(msg("m1", "user"))
        events.clear()

        model.updateContent("m1", filePart("f1", "m1", "image/png", "file:///tmp/a.png", "a.png"))

        val file = model.message("m1")!!.parts["f1"] as FileAttachment
        assertEquals("image/png", file.mime)
        assertEquals("file:///tmp/a.png", file.url)
        assertEquals("a.png", file.filename)
        assertEquals("ContentAdded m1/f1", events.single().toString())

        model.updateContent("m1", filePart("f1", "m1", "application/pdf", "file:///tmp/b.pdf", "b.pdf"))

        assertSame(file, model.message("m1")!!.parts["f1"])
        assertEquals("application/pdf", file.mime)
        assertEquals("file:///tmp/b.pdf", file.url)
        assertEquals("b.pdf", file.filename)
        assertTrue(events.any { it.toString() == "ContentUpdated m1/f1" })
        assertModel("""
            user#m1
            file#f1 application/pdf b.pdf
        """)
    }

    fun `test updateContent tool creates Tool content and tracks state`() {
        model.addMessage(msg("m1", "assistant"))

        model.updateContent("m1", part("p1", "m1", "tool", tool = "bash", state = "running", title = "ls"))

        val p = model.message("m1")!!.parts["p1"] as Tool
        assertEquals("bash", p.name)
        assertEquals(ToolKind.GENERIC, p.kind)
        assertEquals(ToolExecState.RUNNING, p.state)
        assertEquals("ls", p.title)
    }

    fun `test updateContent tool derives tool kind from name`() {
        model.addMessage(msg("m1", "assistant"))

        model.updateContent("m1", part("p1", "m1", "tool", tool = "read"))
        model.updateContent("m1", part("p2", "m1", "tool", tool = "glob"))
        model.updateContent("m1", part("p3", "m1", "tool", tool = "write"))
        model.updateContent("m1", part("p4", "m1", "tool", tool = "apply_patch"))
        model.updateContent("m1", part("p5", "m1", "tool", tool = "bash"))

        assertEquals(ToolKind.READ, (model.message("m1")!!.parts["p1"] as Tool).kind)
        assertEquals(ToolKind.READ, (model.message("m1")!!.parts["p2"] as Tool).kind)
        assertEquals(ToolKind.WRITE, (model.message("m1")!!.parts["p3"] as Tool).kind)
        assertEquals(ToolKind.WRITE, (model.message("m1")!!.parts["p4"] as Tool).kind)
        assertEquals(ToolKind.GENERIC, (model.message("m1")!!.parts["p5"] as Tool).kind)
    }

    fun `test updateContent tool stores rich fields`() {
        model.addMessage(msg("m1", "assistant"))
        val todos = listOf(TodoDto("Write tests", "completed", "high", changed = true))
        val view = TodoViewDto("compact", todos, hiddenBefore = 1, hiddenAfter = 2, changed = 1)

        model.updateContent(
            "m1",
            part(
                "p1", "m1", "tool",
                tool = "bash",
                state = "completed",
                title = "Show history",
                input = mapOf("command" to "git log", "description" to "Show history"),
                metadata = mapOf("source" to "state"),
                output = "abc123 init",
                error = "failed",
                time = PartTimeDto(1.0, 2.0),
                todos = todos,
                todoView = view,
            ),
        )

        val p = model.message("m1")!!.parts["p1"] as Tool
        assertEquals("git log", p.input["command"])
        assertEquals("Show history", p.input["description"])
        assertEquals("state", p.metadata["source"])
        assertEquals("abc123 init", p.output)
        assertEquals("failed", p.error)
        assertEquals(1.0, p.time?.start)
        assertEquals(2.0, p.time?.end)
        assertEquals(todos, p.todos)
        assertEquals(view, p.todoView)
    }

    fun `test updateContent tool updates lifecycle`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "tool", tool = "bash", state = "pending"))
        events.clear()

        model.updateContent("m1", part("p1", "m1", "tool", tool = "bash", state = "completed"))

        val p = model.message("m1")!!.parts["p1"] as Tool
        assertEquals(ToolKind.GENERIC, p.kind)
        assertEquals(ToolExecState.COMPLETED, p.state)
        assertTrue(events.single() is SessionModelEvent.ContentUpdated)
    }

    fun `test updateContent task rekeys child tracking when session id changes`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", taskPart("task", "m1", "child_old"))
        model.upsertChildTool("child_old", childPart("read_old"))
        assertEquals("read_old", task("m1", "task").childTools.single().id)

        model.updateContent("m1", taskPart("task", "m1", "child_new"))
        assertTrue(task("m1", "task").childTools.isEmpty())

        model.upsertChildTool("child_old", childPart("read_stale"))
        assertTrue(task("m1", "task").childTools.isEmpty())

        model.upsertChildTool("child_new", childPart("read_new"))
        assertEquals("read_new", task("m1", "task").childTools.single().id)
    }

    fun `test stale child history cannot resurrect removed child tool`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", taskPart("task", "m1", "child"))

        model.removeChildTool("child", "read_old")
        model.upsertChildTool("child", childPart("read_old"), replace = false)

        assertTrue(task("m1", "task").childTools.isEmpty())

        model.upsertChildTool("child", childPart("read_old"))

        assertEquals("read_old", task("m1", "task").childTools.single().id)
    }

    fun `test removeContent untracks child tools`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", taskPart("task", "m1", "child"))
        model.upsertChildTool("child", childPart("read_old"))
        model.removeContent("m1", "task")
        events.clear()

        model.upsertChildTool("child", childPart("read_new"))

        assertNull(model.content("m1", "task"))
        assertTrue(events.isEmpty())
    }

    fun `test removeMessage untracks child tools`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", taskPart("task", "m1", "child"))
        model.upsertChildTool("child", childPart("read_old"))
        model.removeMessage("m1")
        events.clear()

        model.upsertChildTool("child", childPart("read_new"))

        assertNull(model.message("m1"))
        assertTrue(events.isEmpty())
    }

    fun `test updateContent tool updates rich fields`() {
        model.addMessage(msg("m1", "assistant"))
        model.updateContent("m1", part("p1", "m1", "tool", tool = "bash", state = "pending"))
        events.clear()
        val todos = listOf(TodoDto("Review", "pending", "medium"))

        model.updateContent(
            "m1",
            part(
                "p1", "m1", "tool",
                tool = "bash",
                state = "completed",
                input = mapOf("command" to "git remote -v"),
                output = "origin",
                todos = todos,
            ),
        )

        val p = model.message("m1")!!.parts["p1"] as Tool
        assertEquals("git remote -v", p.input["command"])
        assertEquals("origin", p.output)
        assertEquals(todos, p.todos)
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

    fun `test updateContent stores step-finish parts`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.updateContent("m1", part(
            "p1",
            "m1",
            "step-finish",
            reason = "stop",
            cost = 0.005,
            tokens = TokensDto(100, 50, 10, 20, 5),
        ))

        val part = model.message("m1")!!.parts["p1"]
        assertTrue(part is StepFinish)
        assertEquals("stop", (part as StepFinish).reason)
        assertEquals(0.005, part.cost)
        assertEquals(100L, part.tokens?.input)
        assertTrue(events.single() is SessionModelEvent.ContentAdded)
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

    fun `test appendDelta ignores hidden synthetic user text part`() {
        model.addMessage(msg("m1", "user"))
        model.updateContent("m1", part("p1", "m1", "text", text = "hidden", synthetic = true))
        events.clear()

        model.appendDelta("m1", "p1", "still hidden")

        assertNull(model.message("m1")!!.parts["p1"])
        assertTrue(events.isEmpty())
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

    fun `test setState duplicate is no-op`() {
        val state = SessionState.Busy("thinking")
        model.setState(state)
        events.clear()

        model.setState(state)

        assertTrue(events.isEmpty())
        assertEquals(state, model.state)
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

    fun `test loadHistory preserves rich tool fields and reasoning done`() {
        model.loadHistory(listOf(
            MessageWithPartsDto(
                msg("m1", "assistant"),
                listOf(
                    part("r1", "m1", "reasoning", text = "done", time = PartTimeDto(1.0, 2.0)),
                    part("t1", "m1", "tool", tool = "read", state = "completed", input = mapOf("filePath" to "README.MD"), output = "content"),
                ),
            ),
        ))

        val reasoning = model.message("m1")!!.parts["r1"] as Reasoning
        val tool = model.message("m1")!!.parts["t1"] as Tool
        assertTrue(reasoning.done)
        assertEquals("README.MD", tool.input["filePath"])
        assertEquals("content", tool.output)
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

    fun `test loadHistory drops silent parts and preserves step-finish parts`() {
        val text = PartDto(id = "p1", sessionID = "s1", messageID = "m1", type = "text", text = "visible")
        val stepStart = PartDto(id = "p2", sessionID = "s1", messageID = "m1", type = "step-start")
        val stepFinish = PartDto(id = "p3", sessionID = "s1", messageID = "m1", type = "step-finish")
        val patch = PartDto(id = "p4", sessionID = "s1", messageID = "m1", type = "patch")

        model.loadHistory(listOf(MessageWithPartsDto(msg("m1", "assistant"), listOf(text, stepStart, stepFinish, patch))))

        val entry = model.message("m1")!!
        assertEquals(listOf("p1", "p3"), entry.parts.keys.toList())
        assertTrue(entry.parts["p3"] is StepFinish)
    }

    fun `test loadHistory skips user synthetic text`() {
        model.loadHistory(listOf(MessageWithPartsDto(
            msg("m1", "user"),
            listOf(
                part("p1", "m1", "text", text = "visible"),
                part("p2", "m1", "text", text = "hidden", synthetic = true),
            ),
        )))

        assertModel("""
            user#m1
            text#p1:
              visible
        """)
    }

    fun `test file attachment preserves source metadata`() {
        val source = PartSourceDto("file", PartSourceTextDto("@src/a.kt", 0.0, 9.0), path = "src/a.kt")
        model.addMessage(msg("m1", "user"))

        model.updateContent("m1", filePart("f1", "m1", "text/plain", "file:///tmp/a.kt", "a.kt", source))

        val file = model.message("m1")!!.parts["f1"] as FileAttachment
        assertEquals(source, file.source)
    }

    fun `test updateContent drops patch parts`() {
        model.addMessage(msg("m1", "assistant"))
        events.clear()

        model.updateContent("m1", PartDto(id = "p1", sessionID = "s1", messageID = "m1", type = "patch"))

        assertFalse(model.message("m1")!!.parts.containsKey("p1"))
        assertTrue(events.isEmpty())
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
        model.addListener(child) {
            if (it !is SessionModelEvent.HeaderUpdated) extra.add(it)
        }

        model.addMessage(msg("m1", "user"))
        assertEquals(2, extra.size)  // MessageAdded + TurnAdded

        Disposer.dispose(child)
        extra.clear()

        model.addMessage(msg("m2", "user"))
        assertTrue(extra.isEmpty())
    }

    fun `test header snapshot hidden with no messages`() {
        assertFalse(model.header.visible)
        assertEquals("New Session", model.header.title)
        assertFalse(model.header.canCompact)
    }

    fun `test header snapshot totals assistant cost only`() {
        model.model = "kilo/gpt-5"
        model.upsertMessage(msg("u1", "user", cost = 10.0))
        model.upsertMessage(msg("a1", "assistant", cost = 0.25))
        model.upsertMessage(msg("a2", "assistant", cost = 0.75))

        assertTrue(model.header.visible)
        assertEquals(1.0, model.header.cost)
        assertTrue(model.header.canCompact)
    }

    fun `test header snapshot uses last assistant tokens and model limit`() {
        model.models = listOf(ModelItem(
            id = "gpt-5",
            display = "GPT-5",
            provider = "kilo",
            providerName = "Kilo",
            recommendedIndex = null,
            free = false,
            variants = emptyList(),
            limit = ModelLimitItem(context = 1000, input = 800, output = 200),
        ))
        model.model = "kilo/gpt-5"
        model.upsertMessage(msg("a1", "assistant", tokens = TokensDto(100, 50, 25, 25, 0)))
        model.upsertMessage(msg("a2", "assistant", tokens = TokensDto(200, 100, 0, 0, 0)))

        assertEquals(300L, model.header.context?.tokens)
        assertEquals(30, model.header.context?.percentage)
        assertEquals(1000L, model.header.context?.limit)
        assertEquals(200L, model.header.context?.output)
        assertEquals(200L, model.header.tokens?.input)
    }

    fun `test header snapshot tracks todo summary`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.setTodos(listOf(
            TodoDto("Write tests", "completed", "high"),
            TodoDto("Ship it", "pending", "medium"),
        ))

        assertEquals(2, model.header.todos.total)
        assertEquals(1, model.header.todos.completed)
        assertEquals("Write tests", model.header.todos.items[0].content)
    }

    fun `test header snapshot tracks session title and timeline`() {
        model.setSession(session("Updated title"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("t1", "a1", "tool", tool = "bash", state = "running", title = "Run tests", time = PartTimeDto(1.0, 3.0)))
        model.updateContent("a1", part("s1", "a1", "step-finish", tokens = TokensDto(200, 100, 25, 0, 0)))

        val item = model.header.timeline[0]
        val step = model.header.timeline[1]
        assertEquals("Updated title", model.header.title)
        assertTrue(item.part is Tool)
        assertEquals("bash", (item.part as Tool).name)
        assertEquals("Run tests", item.title)
        assertEquals(2000L, item.durationMs)
        assertTrue(item.active)
        assertTrue(step.part is StepFinish)
        assertEquals("Step finish", step.title)
        assertEquals(10, step.weight)
        assertFalse(step.active)
    }

    fun `test header timeline clamps large step finish token weight`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("s1", "a1", "step-finish", tokens = TokensDto(Long.MAX_VALUE, 1, 1, 0, 0)))

        assertEquals(10, model.header.timeline.single().weight)
    }

    fun `test loadHistory and clear reset header state`() {
        model.setSession(session("Old title"))
        model.upsertMessage(msg("a1", "assistant", cost = 1.0))

        model.loadHistory(emptyList())
        assertFalse(model.header.visible)
        assertEquals("New Session", model.header.title)

        model.upsertMessage(msg("a2", "assistant", cost = 1.0))
        model.clear()
        assertFalse(model.header.visible)
        assertNull(model.header.cost)
    }

    private fun msg(id: String, role: String, cost: Double? = null, tokens: TokensDto? = null) = MessageDto(
        id = id,
        sessionID = "ses",
        role = role,
        time = MessageTimeDto(created = 0.0),
        cost = cost,
        tokens = tokens,
    )

    private fun session(title: String) = SessionDto(
        id = "ses",
        projectID = "proj",
        directory = "/test",
        title = title,
        version = "1",
        time = SessionTimeDto(created = 0.0, updated = 0.0),
    )

    private fun part(
        id: String,
        mid: String,
        type: String,
        text: String? = null,
        tool: String? = null,
        state: String? = null,
        title: String? = null,
        input: Map<String, String> = emptyMap(),
        metadata: Map<String, String> = emptyMap(),
        output: String? = null,
        error: String? = null,
        time: PartTimeDto? = null,
        reason: String? = null,
        cost: Double? = null,
        tokens: TokensDto? = null,
        todos: List<TodoDto> = emptyList(),
        todoView: TodoViewDto? = null,
        mime: String? = null,
        url: String? = null,
        filename: String? = null,
        synthetic: Boolean? = null,
        source: PartSourceDto? = null,
    ) = PartDto(
        id = id,
        sessionID = "ses",
        messageID = mid,
        type = type,
        text = text,
        mime = mime,
        url = url,
        filename = filename,
        synthetic = synthetic,
        source = source,
        tool = tool,
        state = state,
        title = title,
        input = input,
        metadata = metadata,
        output = output,
        error = error,
        time = time,
        todos = todos,
        todoView = todoView,
        reason = reason,
        cost = cost,
        tokens = tokens,
    )

    private fun filePart(id: String, mid: String, mime: String, url: String, filename: String, source: PartSourceDto? = null) = part(
        id = id,
        mid = mid,
        type = "file",
        mime = mime,
        url = url,
        filename = filename,
        source = source,
    )

    private fun taskPart(id: String, mid: String, child: String) = part(
        id = id,
        mid = mid,
        type = "tool",
        tool = "task",
        metadata = mapOf("sessionId" to child),
    )

    private fun childPart(id: String) = part(
        id = id,
        mid = "child_msg",
        type = "tool",
        tool = "read",
        input = mapOf("filePath" to "src/Main.kt"),
    )

    private fun task(mid: String, id: String) = model.content(mid, id) as Tool

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

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }
}
