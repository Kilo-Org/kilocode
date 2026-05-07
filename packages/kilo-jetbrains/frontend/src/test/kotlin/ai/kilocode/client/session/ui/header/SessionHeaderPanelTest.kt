package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.StepFinish
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.session.update.SessionControllerTestBase
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PartTimeDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TokensDto
import com.intellij.ide.util.PropertiesComponent
import java.awt.Color
import java.awt.Point
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelEvent

class SessionHeaderPanelTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        reset()
    }

    override fun tearDown() {
        try {
            reset()
        } finally {
            super.tearDown()
        }
    }

    fun `test starts hidden for empty header`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val c = controller()
        flush()
        val panel = SessionHeaderPanel(c, parent)

        assertFalse(panel.isVisible)
        assertEquals("New Session", panel.titleText())
    }

    fun `test shows populated session header`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        val style = SessionStyle.current()

        assertTrue(panel.isVisible)
        assertTrue(panel.isExpanded())
        assertEquals("Generated title", panel.titleText())
        assertEquals("$0.07", panel.costText())
        assertEquals("1%", panel.contextText())
        assertEquals("Tokens 13.7K 2.5K cache write 25 cache read 75", panel.tokenText())
        assertEquals("Tokens used by the latest assistant response: input, output, cache writes, and cache reads.", panel.tokenTip())
        assertEquals("13.7K", panel.inputTokenText())
        assertEquals("2.5K", panel.outputTokenText())
        assertEquals("cache write 25", panel.cacheWriteText())
        assertEquals("cache read 75", panel.cacheReadText())
        assertEquals("1/2 todos complete", panel.todoText())
        assertTrue(panel.todoVisible())
        assertEquals(style.editorBackground, panel.background)
        assertEquals(
            List(panel.foregrounds().size) { style.editorForeground },
            panel.foregrounds(),
        )
        assertNotNull(panel.expandButton().icon)
    }

    fun `test compact button follows eligibility and invokes controller`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)

        assertTrue(panel.compactButton().isEnabled)
        panel.compactButton().doClick()
        flush()
        assertEquals(1, rpc.compacts.size)

        emit(ChatEventDto.TurnOpen("ses_test"))
        assertFalse(panel.compactButton().isEnabled)
        panel.compactButton().doClick()
        flush()
        assertEquals(1, rpc.compacts.size)
    }

    fun `test retained labels update on later header event`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        val button = panel.compactButton()

        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test", title = "New title")))
        emit(ChatEventDto.MessageUpdated("ses_test", assistant(cost = 0.2, tokens = TokensDto(1_000, 500, 0, 0, 0))))

        assertSame(button, panel.compactButton())
        assertEquals("New title", panel.titleText())
        assertEquals("$0.20", panel.costText())
        assertEquals("Tokens 1.0K 500", panel.tokenText())
        assertEquals("1.0K", panel.inputTokenText())
        assertEquals("500", panel.outputTokenText())
    }

    fun `test apply style updates header colors`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        val style = SessionStyle.current().copy(
            editorForeground = Color(1, 2, 3),
            editorBackground = Color(4, 5, 6),
        )

        panel.applyStyle(style)

        assertEquals(style.editorBackground, panel.background)
        assertEquals(
            List(panel.foregrounds().size) { style.editorForeground },
            panel.foregrounds(),
        )
        assertEquals(
            List(panel.contextBarForegrounds().size) { style.editorForeground },
            panel.contextBarForegrounds(),
        )
    }

    fun `test expanded body shows timeline context and token metrics`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        val style = SessionStyle.current()
        val body = panel.bodyPanel()
        val timeline = panel.timelinePanel()
        val bar = panel.contextBar()

        assertTrue(panel.isExpanded())
        assertSame(body, panel.bodyPanel())
        assertSame(timeline, panel.timelinePanel())
        assertSame(bar, panel.contextBar())
        assertEquals(listOf(panel.timelineViewport(), panel.tokenPanel(), bar), panel.bodyComponents().take(3))
        assertSame(timeline, panel.timelineViewport().view)
        assertFalse(panel.timelineViewport().isOpaque)
        assertEquals(4, panel.timelineCount())
        val parts = panel.timelineParts()
        assertTrue(parts[0] is Reasoning)
        assertEquals("bash", (parts[1] as Tool).name)
        assertEquals(ToolKind.GENERIC, (parts[1] as Tool).kind)
        assertEquals(ToolExecState.ERROR, (parts[2] as Tool).state)
        assertTrue(parts[3] is StepFinish)
        assertTrue(panel.timelineActive(0))
        assertTrue(panel.timelineActive(1))
        assertFalse(panel.timelineActive(2))
        assertFalse(panel.timelineActive(3))
        assertTrue(panel.contextBarVisible())
        assertEquals(16_300L, panel.contextBarUsed())
        assertEquals(200_000L, panel.contextBarReserved())
        assertEquals(1_783_700L, panel.contextBarAvailable())
        assertEquals(2_000_000L, panel.contextBarLimit())
        assertEquals(
            List(panel.contextBarForegrounds().size) { style.editorForeground },
            panel.contextBarForegrounds(),
        )
        assertEquals("16.3K / 2.0M tokens used\n200.0K reserved for output\n1.8M available", panel.contextBarTip())
        assertNotSame(panel.contextBarTrackColor(), panel.contextBarReservedColor())
        assertNotSame(panel.contextBarUsedColor(), panel.contextBarReservedColor())
        assertEquals(panel.timelinePreferredSize().height, panel.timelineViewportPreferredSize().height)
        assertEquals(0, panel.timelineViewportPreferredSize().width)
        assertTrue(panel.timelinePreferredSize().height >= panel.contextBar().preferredSize.height)
        assertTrue(panel.timelineBarHeight(1) < panel.timelineViewportPreferredSize().height)
        assertTrue(panel.timelineBarHeight(0) < panel.timelineBarHeight(1))
        assertEquals(panel.timelineBarHeight(1), panel.timelineBarHeight(2))
        assertTrue(panel.timelineBarHeight(3) > panel.timelineBarHeight(1))

        timeline.dispatchEvent(MouseEvent(
            timeline,
            MouseEvent.MOUSE_MOVED,
            System.currentTimeMillis(),
            0,
            panel.timelineBarWidth() + 1,
            panel.timelinePreferredSize().height - 1,
            0,
            false,
        ))
        assertEquals("Run tests", panel.timelineToolTip())
        assertEquals(1, panel.timelineHover())
        timeline.dispatchEvent(MouseEvent(
            timeline,
            MouseEvent.MOUSE_MOVED,
            System.currentTimeMillis(),
            0,
            panel.timelineBarWidth() * 3 + 1,
            panel.timelinePreferredSize().height - 1,
            0,
            false,
        ))
        assertEquals("Step finish", panel.timelineToolTip())
        assertEquals(3, panel.timelineHover())
        timeline.dispatchEvent(MouseEvent(
            timeline,
            MouseEvent.MOUSE_MOVED,
            System.currentTimeMillis(),
            0,
            panel.timelineBarWidth() - 1,
            0,
            0,
            false,
        ))
        assertNull(panel.timelineToolTip())
        assertEquals(-1, panel.timelineHover())

        panel.expandButton().doClick()

        assertFalse(panel.isExpanded())
        assertSame(body, panel.bodyPanel())
        assertSame(timeline, panel.timelinePanel())
        assertSame(bar, panel.contextBar())
        assertEquals(4, panel.timelineCount())
    }

    fun `test read and write timeline tooltips show filename`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        emit(ChatEventDto.PartUpdated(
            "ses_test",
            tool("tool_read", "read", "completed", "Read file", input = mapOf("filePath" to "src/docs/README.md")),
        ))
        emit(ChatEventDto.PartUpdated(
            "ses_test",
            tool("tool_write", "write", "completed", "Write file", input = mapOf("filePath" to "src/main/App.kt")),
        ))
        val timeline = panel.timelinePanel()

        move(panel, 4)
        assertEquals("Read README.md", panel.timelineToolTip())
        move(panel, 5)
        assertEquals("Write App.kt", panel.timelineToolTip())

        assertSame(timeline, panel.timelinePanel())
    }

    fun `test expand button owns expanded state across updates`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)

        assertTrue(panel.isExpanded())
        assertEquals("Hide session metrics", panel.expandTip())

        panel.expandButton().doClick()
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test", title = "New title")))

        assertFalse(panel.isExpanded())
        assertEquals("Show session metrics", panel.expandTip())

        panel.expandButton().doClick()
        emit(ChatEventDto.MessageUpdated("ses_test", assistant(cost = 0.2)))

        assertTrue(panel.isExpanded())
        assertEquals("Hide session metrics", panel.expandTip())
    }

    fun `test collapse persists and new header starts collapsed`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)

        panel.expandButton().doClick()

        assertFalse(panel.isExpanded())
        assertFalse(PropertiesComponent.getInstance().getBoolean(SessionHeaderPanel.EXPANDED_KEY, true))

        val next = SessionHeaderPanel(c, parent)

        assertFalse(next.isExpanded())
        assertEquals("Show session metrics", next.expandTip())
    }

    fun `test expand persists and new header starts expanded`() {
        PropertiesComponent.getInstance().setValue(SessionHeaderPanel.EXPANDED_KEY, "false")
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)

        assertFalse(panel.isExpanded())

        panel.expandButton().doClick()

        assertTrue(panel.isExpanded())
        assertTrue(PropertiesComponent.getInstance().getBoolean(SessionHeaderPanel.EXPANDED_KEY, false))

        val next = SessionHeaderPanel(c, parent)

        assertTrue(next.isExpanded())
        assertEquals("Hide session metrics", next.expandTip())
    }

    fun `test hidden empty header collapse keeps saved expansion preference`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val c = controller()
        flush()
        val panel = SessionHeaderPanel(c, parent)

        assertFalse(panel.isVisible)
        assertFalse(panel.isExpanded())
        assertTrue(PropertiesComponent.getInstance().getBoolean(SessionHeaderPanel.EXPANDED_KEY, true))

        edt { c.prompt("go") }
        flush()
        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test", title = "Generated title")))
        emit(ChatEventDto.MessageUpdated("ses_test", assistant()))

        assertTrue(panel.isVisible)
        assertTrue(panel.isExpanded())
    }

    fun `test context bar uses neutral grey colors`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        val color = panel.contextBarUsedColor()

        emit(ChatEventDto.MessageUpdated("ses_test", assistant(tokens = TokensDto(1_200_000, 0, 0, 0, 0))))

        assertEquals(color, panel.contextBarUsedColor())
        assertNotSame(panel.contextBarTrackColor(), panel.contextBarUsedColor())
        assertNotSame(panel.contextBarTrackColor(), panel.contextBarReservedColor())
        assertNotSame(panel.contextBarUsedColor(), panel.contextBarReservedColor())
    }

    fun `test timeline width uses uniform bars and gaps`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        val first = panel.timelinePreferredSize().width

        emit(ChatEventDto.PartUpdated("ses_test", tool("tool_3", "bash", "running", "Short")))

        val next = panel.timelinePreferredSize().width
        assertTrue(first > 0)
        assertEquals(5, panel.timelineCount())
        assertEquals(panel.timelineBarWidth(), next - first)
    }

    fun `test timeline drags horizontally inside viewport`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        repeat(12) { idx ->
            emit(ChatEventDto.PartUpdated("ses_test", tool("tool_more_$idx", "bash", "running", "More $idx")))
        }
        panel.timelineViewport().setSize(panel.timelineBarWidth() * 4, panel.timelineViewportPreferredSize().height)
        panel.timelineViewport().doLayout()
        panel.timelineViewport().viewPosition = Point(0, 0)

        val x = panel.timelineViewport().viewPosition.x
        val y = panel.timelineViewport().viewPosition.y
        val timeline = panel.timelinePanel()
        timeline.dispatchEvent(MouseEvent(
            timeline,
            MouseEvent.MOUSE_PRESSED,
            System.currentTimeMillis(),
            0,
            panel.timelineBarWidth() * 3,
            1,
            1,
            false,
        ))
        timeline.dispatchEvent(MouseEvent(
            timeline,
            MouseEvent.MOUSE_DRAGGED,
            System.currentTimeMillis(),
            0,
            panel.timelineBarWidth(),
            1,
            0,
            false,
        ))

        assertTrue(panel.timelineViewport().viewPosition.x > x)
        assertEquals(y, panel.timelineViewport().viewPosition.y)
    }

    fun `test timeline touch scrolls horizontally inside viewport`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        repeat(12) { idx ->
            emit(ChatEventDto.PartUpdated("ses_test", tool("tool_touch_$idx", "bash", "running", "Touch $idx")))
        }
        panel.timelineViewport().setSize(panel.timelineBarWidth() * 4, panel.timelineViewportPreferredSize().height)
        panel.timelineViewport().doLayout()
        panel.timelineViewport().viewPosition = Point(0, 0)

        val x = panel.timelineViewport().viewPosition.x
        val y = panel.timelineViewport().viewPosition.y
        val timeline = panel.timelinePanel()
        timeline.dispatchEvent(MouseWheelEvent(
            timeline,
            MouseWheelEvent.MOUSE_WHEEL,
            System.currentTimeMillis(),
            0,
            1,
            1,
            1,
            1,
            0,
            false,
            3,
            panel.timelineBarWidth(),
            1,
            panel.timelineBarWidth().toDouble(),
        ))

        assertTrue(panel.timelineViewport().viewPosition.x > x)
        assertEquals(y, panel.timelineViewport().viewPosition.y)
    }

    fun `test timeline wheel scrolls horizontally inside viewport`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        repeat(12) { idx ->
            emit(ChatEventDto.PartUpdated("ses_test", tool("tool_wheel_$idx", "bash", "running", "Wheel $idx")))
        }
        panel.timelineViewport().setSize(panel.timelineBarWidth() * 4, panel.timelineViewportPreferredSize().height)
        panel.timelineViewport().doLayout()
        panel.timelineViewport().viewPosition = Point(0, 0)

        val x = panel.timelineViewport().viewPosition.x
        val y = panel.timelineViewport().viewPosition.y
        val timeline = panel.timelinePanel()
        timeline.dispatchEvent(MouseWheelEvent(
            timeline,
            MouseWheelEvent.MOUSE_WHEEL,
            System.currentTimeMillis(),
            0,
            1,
            1,
            1,
            1,
            0,
            false,
            MouseWheelEvent.WHEEL_UNIT_SCROLL,
            1,
            1,
            1.0,
        ))

        assertTrue(panel.timelineViewport().viewPosition.x > x)
        assertEquals(y, panel.timelineViewport().viewPosition.y)
    }

    fun `test timeline append scrolls viewport to end`() {
        val c = promptedHeader()
        val panel = SessionHeaderPanel(c, parent)
        repeat(12) { idx ->
            emit(ChatEventDto.PartUpdated("ses_test", tool("tool_more_$idx", "bash", "running", "More $idx")))
        }
        panel.timelineViewport().setSize(panel.timelineBarWidth() * 4, panel.timelineViewportPreferredSize().height)
        panel.timelineViewport().doLayout()
        panel.timelineViewport().viewPosition = Point(0, 0)

        emit(ChatEventDto.PartUpdated("ses_test", tool("tool_more_final", "bash", "running", "Final")))
        panel.timelineViewport().doLayout()
        flush()

        val max = panel.timelinePreferredSize().width - panel.timelineViewport().extentSize.width
        assertTrue(max > 0)
        assertEquals(max, panel.timelineViewport().viewPosition.x)
        assertEquals(0, panel.timelineViewport().viewPosition.y)
    }

    private fun promptedHeader(): ai.kilocode.client.session.update.SessionController {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(
            ai.kilocode.rpc.dto.KiloAppStatusDto.READY,
            config = ai.kilocode.rpc.dto.ConfigDto(model = "kilo/gpt-5"),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "gpt-5" to ModelDto(
                            id = "gpt-5",
                            name = "GPT-5",
                            limit = ai.kilocode.rpc.dto.ModelLimitDto(context = 2_000_000, output = 200_000),
                        ),
                    ),
                ),
            ),
        )
        val c = controller()
        flush()
        edt { c.prompt("go") }
        flush()

        emit(ChatEventDto.SessionUpdated("ses_test", session("ses_test", title = "Generated title")))
        emit(ChatEventDto.MessageUpdated("ses_test", assistant()))
        emit(ChatEventDto.PartUpdated("ses_test", reasoning(done = false, text = "Thinking")))
        emit(ChatEventDto.PartUpdated("ses_test", tool("tool_1", "bash", "running", "Run tests", input = mapOf("cmd" to "test", "files" to "src"))))
        emit(ChatEventDto.PartUpdated("ses_test", tool("tool_2", "edit", "error", "Edit file", input = mapOf("cmd" to "test", "files" to "src"))))
        emit(ChatEventDto.PartUpdated("ses_test", stepFinish()))
        emit(ChatEventDto.TodoUpdated("ses_test", listOf(
            TodoDto("Write tests", "completed", "high"),
            TodoDto("Ship it", "pending", "medium"),
        )))
        return c
    }

    private fun assistant(
        cost: Double = 0.07,
        tokens: TokensDto = TokensDto(13_700, 2_000, 500, 75, 25),
    ) = MessageDto(
        id = "msg1",
        sessionID = "ses_test",
        role = "assistant",
        time = MessageTimeDto(created = 0.0),
        cost = cost,
        tokens = tokens,
    )

    private fun reasoning(done: Boolean, text: String) = PartDto(
        id = "reasoning_1",
        sessionID = "ses_test",
        messageID = "msg1",
        type = "reasoning",
        text = text,
        time = if (done) PartTimeDto(1.0, 2.0) else PartTimeDto(1.0, null),
    )

    private fun tool(
        id: String,
        name: String,
        state: String,
        title: String,
        input: Map<String, String> = mapOf("cmd" to "test"),
    ) = PartDto(
        id = id,
        sessionID = "ses_test",
        messageID = "msg1",
        type = "tool",
        tool = name,
        state = state,
        title = title,
        input = input,
        time = PartTimeDto(1.0, 3.0),
    )

    private fun stepFinish() = PartDto(
        id = "step_finish_1",
        sessionID = "ses_test",
        messageID = "msg1",
        type = "step-finish",
        reason = "stop",
        cost = 0.07,
        tokens = TokensDto(13_700, 2_000, 500, 75, 25),
    )

    private fun move(panel: SessionHeaderPanel, index: Int) {
        val timeline = panel.timelinePanel()
        timeline.dispatchEvent(MouseEvent(
            timeline,
            MouseEvent.MOUSE_MOVED,
            System.currentTimeMillis(),
            0,
            panel.timelineBarWidth() * index + 1,
            panel.timelinePreferredSize().height - 1,
            0,
            false,
        ))
    }

    private fun reset() {
        PropertiesComponent.getInstance().unsetValue(SessionHeaderPanel.EXPANDED_KEY)
    }
}
