package ai.kilocode.client.session

import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.ToolRefDto
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBRadioButton
import com.intellij.util.ui.JBUI
import java.awt.Container
import java.awt.Point
import javax.swing.AbstractButton
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.Scrollable
import javax.swing.SwingConstants
import javax.swing.JTextArea
import javax.swing.SwingUtilities
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
        setValuePassive(bar, bottom(bar) - threshold + 1)

        emit(ChatEventDto.MessageUpdated("ses_test", message("tail")))
        drainScroll()

        assertBottom(bar)
    }

    fun `test viewport driven scroll can move away from stale saved position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value
        val target = (value + JBUI.scale(96)).coerceAtMost(bottom(bar) - 1)
        assertTrue("value=$value target=$target bottom=${bottom(bar)}", target > value)

        (scrollComponent() as JBScrollPane).viewport.viewPosition = Point(0, target)
        drainScroll()

        assertEquals(target, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test user scroll upward near bottom disables tail follow`() {
        showMessages()
        fillTranscript(48)
        val bar = scrollBar()
        val threshold = JBUI.scale(32)
        assertTrue("bottom=${bottom(bar)} threshold=$threshold", bottom(bar) > threshold * 2)
        val id = "near_bottom_user_tail"
        val pid = "near_bottom_user_part"
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part(pid, id, "text", "start\n\n")), flush = false)
        forceFlush()
        drainScroll()
        setBottom(bar)
        setValue(bar, bottom(bar) - threshold + 1)
        val value = bar.value
        assertFalse(ui.scroll.following())

        repeat(240) { i ->
            emit(ChatEventDto.PartDelta("ses_test", id, pid, "text", "tail line $i\n"), flush = false)
        }
        forceFlush()
        drainScroll()

        assertTrue("value=$value actual=${bar.value}", bar.value >= value)
        assertFalse(ui.scroll.following())
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

    fun `test no-op wheel at bottom does not cancel following`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)
        wheelNoop()

        emit(ChatEventDto.MessageUpdated("ses_test", message("noop_wheel_tail")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("noop_wheel_part", "noop_wheel_tail", "text", "tail line\n".repeat(120))), flush = false)
        forceFlush()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test physical mouse wheel uses accelerated transcript unit distance`() {
        showMessages()
        fillTranscript(48)
        val bar = scrollBar()
        setValue(bar, 0)
        drainScroll()
        val amount = 3
        val expected = JBUI.scale(SessionUiStyle.SessionLayout.SCROLL_INCREMENT * amount)
        assertTrue("bottom=${bottom(bar)} expected=$expected", bottom(bar) >= expected * 2)

        val view = scrollView() as Scrollable
        val unit = view.getScrollableUnitIncrement(scrollComponent().visibleRect, SwingConstants.VERTICAL, 1)

        assertEquals(expected, unit * amount)
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

    fun `test user scrolling to bottom during massive stream resumes following`() {
        showMessages()
        fillTranscript(48)
        val bar = scrollBar()
        val id = "stream_massive_resume"
        val pid = "stream_massive_resume_part"
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part(pid, id, "text", "start\n\n")), flush = false)
        forceFlush()
        drainScroll()
        setValue(bar, bottom(bar) / 2)
        assertFalse(ui.scroll.following())
        assertTrue(jumpButton().isVisible)
        val first = buildString {
            repeat(160) { i -> append("line $i\n\n") }
        }

        repeat(160) { i ->
            emit(ChatEventDto.PartDelta("ses_test", id, pid, "text", "line $i\n\n"), flush = false)
        }
        emit(ChatEventDto.PartUpdated("ses_test", part(pid, id, "text", "start\n\n${first}snapshot\n\n")), flush = false)
        forceFlush()
        settleShort(100)
        layout()
        setBottom(bar)
        drainScroll()
        setBottom(bar)
        drainScroll()

        assertBottom(bar)
        assertTrue(ui.scroll.following())
        assertFalse(jumpButton().isVisible)
        val second = buildString {
            repeat(160) { i -> append("tail line $i\n\n") }
        }

        repeat(160) { i ->
            emit(ChatEventDto.PartDelta("ses_test", id, pid, "text", "tail line $i\n\n"), flush = false)
        }
        emit(ChatEventDto.PartUpdated("ses_test", part(pid, id, "text", "start\n\n${first}snapshot\n\n${second}snapshot tail\n\n")), flush = false)
        forceFlush()
        settleShort(100)
        drainScroll()

        assertBottom(bar)
        assertTrue(ui.scroll.following())
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

    fun `test expanding tool at bottom preserves clicked header position`() {
        val mid = "tool_expand_bottom"
        val pid = "tool_expand_bottom_part"
        rpc.history.addAll(history(23) + toolHistory(mid, pid) + historyRange(1, start = 23))
        ui = newUi(id = "ses_test")
        settle()
        drainScroll()
        val bar = scrollBar()
        setBottom(bar)
        drainScroll()
        val view = toolView(mid, pid)
        assertFalse(view.bodyVisible())
        val y = visibleY(view)
        val value = bar.value

        view.toggle()
        drainScroll()

        assertTrue(view.bodyVisible())
        assertEquals(y, visibleY(view))
        assertEquals(value, bar.value)
    }

    fun `test expanding tool in middle preserves clicked header position`() {
        val mid = "tool_expand_middle"
        val pid = "tool_expand_middle_part"
        rpc.history.addAll(history(12) + toolHistory(mid, pid) + historyRange(12, start = 12))
        ui = newUi(id = "ses_test")
        settle()
        drainScroll()
        val bar = scrollBar()
        val view = toolView(mid, pid)
        val top = SwingUtilities.convertPoint(view, Point(0, 0), scrollView()).y
        setValue(bar, top - 80)
        drainScroll()
        val y = visibleY(view)

        view.toggle()
        drainScroll()

        assertTrue(view.bodyVisible())
        assertEquals(y, visibleY(view))
        assertTrue(jumpButton().isVisible)
    }

    fun `test long prompt message follows when transcript is at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        val id = "long_prompt_bottom"
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("long_prompt_part", id, "text", "prompt line\n".repeat(120))), flush = false)
        forceFlush()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test long prompt message preserves middle scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        val id = "long_prompt_middle"
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("long_prompt_part", id, "text", "prompt line\n".repeat(120))), flush = false)
        forceFlush()
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test sending long prompt follows after prompt editor shrinks`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)
        findAll<EditorTextField>(ui).first().text = "prompt line\n".repeat(80)
        drainScroll()
        assertBottom(bar)

        find<PromptPanel>(ui).send()
        settleShort(100)
        val text = rpc.prompts.last().third.parts.single().text
        val id = "long_prompt_send"
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("long_prompt_send_part", id, "text", text)), flush = false)
        forceFlush()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test long prompt followed by instant reasoning stays at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)
        findAll<EditorTextField>(ui).first().text = "prompt line\n".repeat(80)
        drainScroll()

        find<PromptPanel>(ui).send()
        settleShort(100)
        val text = rpc.prompts.last().third.parts.single().text
        emit(ChatEventDto.MessageUpdated("ses_test", message("prompt_reasoning_user")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prompt_reasoning_text", "prompt_reasoning_user", "text", text)), flush = false)
        emit(ChatEventDto.MessageUpdated("ses_test", message("prompt_reasoning_assistant").copy(role = "assistant")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prompt_reasoning_part", "prompt_reasoning_assistant", "reasoning", "thinking")), flush = false)
        forceFlush()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test prompt editor growth preserves middle scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        findAll<EditorTextField>(ui).first().text = "prompt line\n".repeat(80)
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test prompt editor growth in middle does not resume following`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        findAll<EditorTextField>(ui).first().text = "prompt line\n".repeat(80)
        drainScroll()
        val value = bar.value

        emit(ChatEventDto.MessageUpdated("ses_test", message("prompt_growth_middle")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prompt_growth_part", "prompt_growth_middle", "text", "tail line\n".repeat(80))), flush = false)
        forceFlush()
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test large question after reasoning stays at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)
        val mid = "question_reasoning_assistant"
        emit(ChatEventDto.MessageUpdated("ses_test", message(mid).copy(role = "assistant")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("question_reasoning_part", mid, "reasoning", "thinking")), flush = false)
        emit(ChatEventDto.QuestionAsked("ses_test", largeQuestion("q_large_after_reasoning")), flush = false)
        forceFlush()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
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

    fun `test scroll button resumes following during massive stream`() {
        showMessages()
        fillTranscript(48)
        val button = jumpButton()
        val bar = scrollBar()
        val id = "stream_massive_button"
        val pid = "stream_massive_button_part"
        emit(ChatEventDto.MessageUpdated("ses_test", message(id)), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part(pid, id, "text", "start\n\n")), flush = false)
        forceFlush()
        drainScroll()
        setValue(bar, bottom(bar) / 2)
        val first = buildString {
            repeat(160) { i -> append("line $i\n\n") }
        }

        repeat(160) { i ->
            emit(ChatEventDto.PartDelta("ses_test", id, pid, "text", "line $i\n\n"), flush = false)
        }
        emit(ChatEventDto.PartUpdated("ses_test", part(pid, id, "text", "start\n\n${first}snapshot\n\n")), flush = false)
        forceFlush()
        settleShort(100)
        drainScroll()

        assertTrue(button.isVisible)
        assertFalse(ui.scroll.following())

        click(button)
        drainScroll()

        assertBottom(bar)
        assertTrue(ui.scroll.following())
        assertFalse(button.isVisible)
        val second = buildString {
            repeat(160) { i -> append("tail line $i\n\n") }
        }

        repeat(160) { i ->
            emit(ChatEventDto.PartDelta("ses_test", id, pid, "text", "tail line $i\n\n"), flush = false)
        }
        emit(ChatEventDto.PartUpdated("ses_test", part(pid, id, "text", "start\n\n${first}snapshot\n\n${second}snapshot tail\n\n")), flush = false)
        forceFlush()
        settleShort(100)
        drainScroll()

        assertBottom(bar)
        assertTrue(ui.scroll.following())
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

    fun `test scroll owns the session viewport without overlapping content`() {
        settle()

        assertSame(scrollComponent(), scrollView()?.parent?.parent)
        assertFalse(scrollView() is SessionMessageListPanel)
        assertFalse((scrollComponent() as JBScrollPane).isOverlappingScrollBar)
    }

    // ------ question/login-required autoscroll ------

    fun `test question appearing at bottom keeps scroll at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        emit(ChatEventDto.QuestionAsked("ses_test", question("q_at_bottom")))
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test question appearing while user is in middle preserves scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        emit(ChatEventDto.QuestionAsked("ses_test", question("q_middle")))
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test question overlay replaces scroll icon and still jumps to bottom`() {
        showMessages()
        fillTranscript(24)
        val button = jumpButton()
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        drainScroll()
        val icon = button.icon

        emit(ChatEventDto.QuestionAsked("ses_test", question("q_overlay")))
        drainScroll()

        assertTrue(button.isVisible)
        assertNotSame(icon, button.icon)
        assertEquals(KiloBundle.message("session.scroll.question"), button.toolTipText)

        click(button)
        drainScroll()

        assertBottom(bar)
        assertFalse(button.isVisible)
    }

    fun `test question overlay returns to scroll icon when question resolves`() {
        showMessages()
        fillTranscript(24)
        val button = jumpButton()
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        drainScroll()
        emit(ChatEventDto.QuestionAsked("ses_test", question("q_resolve")))
        drainScroll()
        val icon = button.icon
        val value = bar.value

        emit(ChatEventDto.QuestionReplied("ses_test", "q_resolve"))
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(button.isVisible)
        assertNotSame(icon, button.icon)
        assertEquals(KiloBundle.message("session.scroll.bottom"), button.toolTipText)
    }

    fun `test plan followup question keeps scroll icon`() {
        showMessages()
        fillTranscript(24)
        val button = jumpButton()
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        drainScroll()
        val icon = button.icon

        emit(ChatEventDto.QuestionAsked("ses_test", question("q_plan", plan = true)))
        drainScroll()

        assertTrue(button.isVisible)
        assertSame(icon, button.icon)
    }

    fun `test question carousel navigation follows when transcript is at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", multiQuestion("q_nav_bottom")))
        drainScroll()
        setBottom(bar)

        option<JBRadioButton>("Minimal").doClick()
        button("Next").doClick()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)

        option<JBRadioButton>("Unit").doClick()
        button("Review").doClick()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)

        button("Back").doClick()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test question carousel navigation follows even when transcript is in middle`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", multiQuestion("q_nav_middle")))
        drainScroll()
        setValue(bar, bottom(bar) / 2)

        option<JBRadioButton>("Minimal").doClick()
        button("Next").doClick()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test question top forward icon follows immediately from middle`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", multiQuestion("q_icon_next_middle")))
        drainScroll()
        setValue(bar, bottom(bar) / 2)

        option<JBRadioButton>("Minimal").doClick()
        icon(KiloBundle.message("session.question.next")).doClick()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test question review navigation follows immediately from middle`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", multiQuestion("q_review_middle")))
        drainScroll()

        option<JBRadioButton>("Minimal").doClick()
        button("Next").doClick()
        drainScroll()
        option<JBRadioButton>("Unit").doClick()
        setValue(bar, bottom(bar) / 2)
        button("Review").doClick()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test question review back footer follows immediately from middle`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", multiQuestion("q_review_back_middle")))
        drainScroll()

        option<JBRadioButton>("Minimal").doClick()
        button("Next").doClick()
        drainScroll()
        option<JBRadioButton>("Unit").doClick()
        button("Review").doClick()
        drainScroll()
        setValue(bar, bottom(bar) / 2)
        button("Back").doClick()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test forced question navigation resumes following subsequent updates`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", multiQuestion("q_nav_resume_follow")))
        drainScroll()
        setValue(bar, bottom(bar) / 2)

        option<JBRadioButton>("Minimal").doClick()
        icon(KiloBundle.message("session.question.next")).doClick()
        emit(ChatEventDto.MessageUpdated("ses_test", message("q_nav_resume_tail")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("q_nav_resume_part", "q_nav_resume_tail", "text", "tail line\n".repeat(80))), flush = false)
        forceFlush()
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test question carousel back to large question follows immediately`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", largeQuestion("q_nav_large")))
        drainScroll()
        setValue(bar, bottom(bar) / 2)

        option<JBRadioButton>("Go").doClick()
        button("Next").doClick()
        drainScroll()
        setValue(bar, bottom(bar) / 2)
        icon(KiloBundle.message("session.question.back")).doClick()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test question reply follows after card hides when transcript is at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", question("q_reply_bottom")))
        drainScroll()
        setBottom(bar)

        option<JBRadioButton>("A").doClick()
        button("Submit").doClick()
        settleShort(100)
        drainScroll()

        assertEquals("q_reply_bottom", rpc.questionReplies.single().first)
        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test question reply preserves middle scroll position after card hides`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", question("q_reply_middle")))
        drainScroll()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        option<JBRadioButton>("A").doClick()
        button("Submit").doClick()
        settleShort(100)
        drainScroll()

        assertEquals("q_reply_middle", rpc.questionReplies.single().first)
        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test custom question answer growth follows when transcript is at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", customQuestion("q_custom_bottom")))
        drainScroll()
        setBottom(bar)

        option<JBRadioButton>("").doClick()
        drainScroll()
        findAll<EditorTextField>(ui).last().text = "custom line\n".repeat(80)
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test custom question answer growth preserves middle scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", customQuestion("q_custom_middle")))
        drainScroll()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        option<JBRadioButton>("").doClick()
        drainScroll()
        findAll<EditorTextField>(ui).last().text = "custom line\n".repeat(80)
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test question text caret visibility cannot move middle scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", largeQuestion("q_text_caret_middle")))
        drainScroll()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        findAll<JTextArea>(ui).first { !it.isEditable }.scrollRectToVisible(java.awt.Rectangle(0, 10_000, 1, 1))
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test question option selection in middle does not resume following`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        emit(ChatEventDto.QuestionAsked("ses_test", question("q_select_middle")))
        drainScroll()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        option<JBRadioButton>("A").doClick()
        drainScroll()
        emit(ChatEventDto.MessageUpdated("ses_test", message("q_select_tail")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("q_select_part", "q_select_tail", "text", "tail line\n".repeat(80))), flush = false)
        forceFlush()
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    fun `test login required appearing at bottom keeps scroll at bottom`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setBottom(bar)

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body)))
        drainScroll()

        assertBottom(bar)
        assertFalse(jumpButton().isVisible)
    }

    fun `test login required appearing while user is in middle preserves scroll position`() {
        showMessages()
        fillTranscript(24)
        val bar = scrollBar()
        setValue(bar, bottom(bar) / 2)
        val value = bar.value

        val body = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}"""
        emit(ChatEventDto.Error("ses_test", MessageErrorDto(type = "APIError", message = "Unauthorized", statusCode = 401, responseBody = body)))
        drainScroll()

        assertEquals(value, bar.value)
        assertTrue(jumpButton().isVisible)
    }

    // ------ helpers ------

    private fun button(text: String): JButton = findAll<JButton>(ui).first { it.text == text }

    private fun icon(text: String): JButton = findAll<JButton>(ui).first { it.toolTipText == text }

    private inline fun <reified T> option(label: String): T where T : AbstractButton =
        findAll<T>(ui).first { it.actionCommand == label }

    private fun toolView(mid: String, pid: String): ToolView {
        val messages = find<SessionMessageListPanel>(ui)
        return messages.findMessage(mid)?.part(pid) as? ToolView
            ?: error("missing tool $mid/$pid\n${messages.dumpDetailed()}")
    }

    private fun visibleY(component: JComponent): Int =
        SwingUtilities.convertPoint(component, Point(0, 0), scrollComponent()).y

    private inline fun <reified T> findAll(root: Container = ui): List<T> = findAll(root, T::class.java)

    private fun <T> findAll(root: Container, cls: Class<T>): List<T> {
        val out = mutableListOf<T>()
        if (cls.isInstance(root)) out.add(cls.cast(root))
        for (child in root.components) {
            if (child is Container && child !is AbstractButton) {
                out.addAll(findAll(child, cls))
            } else if (cls.isInstance(child)) {
                out.add(cls.cast(child))
            }
        }
        return out
    }

    private fun question(id: String, plan: Boolean = false) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(
            QuestionInfoDto(
                question = "Pick one",
                header = "Choice",
                options = listOf(QuestionOptionDto("A", "Option A")),
                multiple = false,
                custom = true,
                questionKey = if (plan) "plan.followup.question" else null,
            ),
        ),
        tool = ToolRefDto("msg1", "call1"),
    )

    private fun multiQuestion(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(
            QuestionInfoDto(
                question = "Choose approach",
                header = "Approach",
                options = listOf(
                    QuestionOptionDto("Minimal", "Smallest safe change"),
                    QuestionOptionDto("Balanced", "Focused implementation"),
                ),
                multiple = false,
                custom = false,
            ),
            QuestionInfoDto(
                question = "Choose test level",
                header = "Test Level",
                options = listOf(
                    QuestionOptionDto("Unit", "Unit tests"),
                    QuestionOptionDto("Integration", "Integration tests"),
                ),
                multiple = false,
                custom = false,
            ),
        ),
        tool = ToolRefDto("msg1", "call1"),
    )

    private fun largeQuestion(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(
            QuestionInfoDto(
                question = "Which backend programming language do you prefer for your project?",
                header = "Backend Language",
                options = listOf(
                    QuestionOptionDto("TypeScript", "Offers excellent ecosystem with Node.js and npm, strong typing for maintainability, good performance via V8, but may have higher memory usage than compiled languages; learning curve is moderate if you know JavaScript."),
                    QuestionOptionDto("Go", "Provides high performance with compiled binaries, simple concurrency model, growing ecosystem, and fast compile times; learning curve is gentle due to minimalistic language design."),
                    QuestionOptionDto("Rust", "Delivers top-tier performance and memory safety without garbage collector, steep learning curve due to ownership concepts, but expanding ecosystem and excellent for system-level services."),
                    QuestionOptionDto("Python", "Boasts vast ecosystem, ease of use and rapid development, but interpreted performance is lower than compiled languages; learning curve is very gentle, ideal for prototyping."),
                ),
                multiple = false,
                custom = true,
            ),
            QuestionInfoDto("Choose database", "Database", listOf(QuestionOptionDto("Postgres", "Reliable relational default")), false, false),
            QuestionInfoDto("Choose deployment target", "Deploy", listOf(QuestionOptionDto("Cloud", "Managed environment")), false, false),
            QuestionInfoDto("Choose testing style", "Testing", listOf(QuestionOptionDto("Integration", "Exercise real implementation")), false, false),
        ),
        tool = ToolRefDto("msg1", "call1"),
    )

    private fun customQuestion(id: String) = QuestionRequestDto(
        id = id,
        sessionID = "ses_test",
        questions = listOf(
            QuestionInfoDto(
                question = "Describe approach",
                header = "Approach",
                options = emptyList(),
                multiple = false,
                custom = true,
            ),
        ),
        tool = ToolRefDto("msg1", "call1"),
    )

    private fun toolPart(id: String, mid: String) = PartDto(
        id = id,
        sessionID = "ses_test",
        messageID = mid,
        type = "tool",
        tool = "bash",
        callID = "call_$id",
        state = "completed",
        title = "print output",
        output = "output line\n".repeat(160),
    )

    private fun toolHistory(mid: String, pid: String) = MessageWithPartsDto(
        message(mid).copy(role = "assistant"),
        listOf(toolPart(pid, mid)),
    )

    private fun historyRange(count: Int, start: Int) = List(count) { offset ->
        val i = start + offset
        val id = "hist_range_$i"
        MessageWithPartsDto(message(id), listOf(part("hist_range_part_$i", id, "text", text(i))))
    }
}
