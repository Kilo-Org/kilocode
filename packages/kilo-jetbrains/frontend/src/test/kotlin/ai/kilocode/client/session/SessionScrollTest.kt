package ai.kilocode.client.session

import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CompletableDeferred

@Suppress("UnstableApiUsage")
class SessionScrollTest : SessionUiTestBase() {

    fun `test session update follows when transcript is at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertBottom(bar)
    }

    fun `test session update follows when transcript is near bottom threshold`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        val threshold = JBUI.scale(32)
        if (bottom(bar) <= threshold) {
            fillTranscript(24, start = 24)
        }
        setValue(bar, bottom(bar) - threshold + 1)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertBottom(bar)
    }

    fun `test session update preserves position outside bottom threshold`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        val threshold = JBUI.scale(32)
        setValue(bar, bottom(bar) - threshold - 8)
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test session update preserves middle scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test user scroll between updates disables following`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail1")))
        drainScroll()
        assertBottom(bar)

        setValue(bar, bottom(bar) / 2)
        val value = bar.value
        emit(ChatEventDto.MessageUpdated("ses_test", message("tail2")))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test user scroll cancels pending follow`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail_pending")), flush = false)
        forceFlushWithoutDispatch()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test stale follow does not override later non follow`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail_stale1")), flush = false)
        forceFlushWithoutDispatch()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value
        emit(ChatEventDto.MessageUpdated("ses_test", message("tail_stale2")))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test user returning to bottom between updates resumes following`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail1")))
        drainScroll()
        assertEquals(value, bar.value)

        setBottom(bar)
        emit(ChatEventDto.MessageUpdated("ses_test", message("tail2")))
        drainScroll()

        assertBottom(bar)
    }

    fun `test part delta follows bottom after height growth`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        val id = "stream_bottom"
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("stream_part", id, "text", "start\n")), flush = false)
        forceFlush()
        setBottom(bar)

        repeat(40) { i ->
            emit(ChatEventDto.PartDelta("ses_test", id, "stream_part", "text", "line $i\n"), flush = false)
        }
        forceFlush()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test part delta preserves middle scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        val id = "stream_middle"
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("stream_part", id, "text", "start\n")), flush = false)
        forceFlush()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        repeat(40) { i ->
            emit(ChatEventDto.PartDelta("ses_test", id, "stream_part", "text", "line $i\n"), flush = false)
        }
        forceFlush()
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test batched update samples scroll once before model changes`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("batch")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("part", "batch", "text", "hello")), flush = false)
        forceFlush()
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test state changes do not force scroll when user is in middle`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.TurnOpen("ses_test"))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test scroll button appears only when transcript is away from bottom`() {
        showMessages()
        fillTranscript(24)
        val button = jumpButton()
        val bar = scrollBar()

        setBottom(bar)
        drainScroll()
        assertFalse(button.isVisible)

        setValue(bar, bottom(bar) / 2)
        drainScroll()
        assertTrue(button.isVisible)

        setBottom(bar)
        drainScroll()
        assertFalse(button.isVisible)
    }

    fun `test scroll button scrolls transcript to bottom`() {
        showMessages()
        fillTranscript(24)
        val button = jumpButton()
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        drainScroll()
        assertTrue(button.isVisible)

        click(button)
        drainScroll()

        assertBottom(bar)
        assertFalse(button.isVisible)
    }

    fun `test scroll button remains hidden outside transcript body`() {
        val button = jumpButton()

        settle()
        layout()

        assertFalse(button.isVisible)
    }

    fun `test history load follows initially empty transcript`() {
        rpc.history.addAll(history(24))
        ui = newUi(id = "ses_test")
        settle()
        drainScroll()

        assertBottom(scrollBar())
    }

    fun `test recovered state after history preserves user scroll position`() {
        rpc.history.addAll(history(24))
        rpc.statuses.value = mapOf("ses_test" to SessionStatusDto("busy"))
        ui = newUi(id = "ses_test")
        settle()
        drainScroll()
        val bar = scrollBar()
        assertBottom(bar)
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.TurnOpen("ses_test"))
        drainScroll()

        assertEquals(value, bar.value)
    }

    fun `test existing session scrolls after recovered dock layout`() {
        rpc.history.addAll(history(24))
        rpc.pendingPermissionList.add(PermissionRequestDto("perm_pending", "ses_test", "edit", listOf("*.kt")))

        ui = newUi(id = "ses_test")
        settle()
        drainScroll()

        assertBottom(scrollBar())
    }

    fun `test replayed event during existing session open cannot cancel initial bottom`() {
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        rpc.history.addAll(history(24))

        ui = newUi(id = "ses_test")
        emit(ChatEventDto.MessageUpdated("ses_test", message("replay")), flush = false)
        gate.complete(Unit)
        settle()
        drainScroll()

        assertBottom(scrollBar())
    }

    fun `test existing session waits for panel layout before initial bottom scroll`() {
        rpc.history.addAll(history(24))

        ui = newUi(id = "ses_test")
        ui.setSize(0, 0)
        settle()

        ui.setSize(800, 600)
        drainScroll()

        assertBottom(scrollBar())
    }

    fun `test existing session scroll waits through deferred transcript revalidation`() {
        rpc.history.addAll(history(24))

        ui = newUi(id = "ses_test")
        settle()
        scrollView()?.preferredSize
        com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater {
            scrollView()?.revalidate()
        }
        drainScroll()

        assertBottom(scrollBar())
    }

    fun `test scroll owns the session viewport`() {
        settle()

        assertSame(scrollComponent(), scrollView()?.parent?.parent)
        assertFalse(scrollView() is SessionMessageListPanel)
    }
}
