package ai.kilocode.client.ui

import ai.kilocode.client.agentManager.worktree.style
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.rpc.dto.GhState
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.Color

@Suppress("UnstableApiUsage")
class UiStyleTest : BasePlatformTestCase() {

    fun `test border is lighter than dark panel`() {
        val panel = Color(0, 0, 0)
        val border = UiStyle.Colors.contrast(panel, SessionUiStyle.View.BORDER_DELTA)

        assertTrue(border.red > panel.red)
        assertTrue(border.green > panel.green)
        assertTrue(border.blue > panel.blue)
    }

    fun `test border is darker than light panel`() {
        val panel = Color(255, 255, 255)
        val border = UiStyle.Colors.contrast(panel, SessionUiStyle.View.BORDER_DELTA)

        assertTrue(border.red < panel.red)
        assertTrue(border.green < panel.green)
        assertTrue(border.blue < panel.blue)
    }

    fun `test hover blends from panel toward border`() {
        val panel = Color(0, 0, 0)
        val border = UiStyle.Colors.contrast(panel, SessionUiStyle.View.BORDER_DELTA)
        val hover = UiStyle.Colors.blend(panel, border, SessionUiStyle.View.HOVER_FILL_ALPHA)

        assertTrue(hover.red > panel.red)
        assertTrue(hover.red < border.red)
        assertEquals(hover.red, hover.green)
        assertEquals(hover.green, hover.blue)
    }

    fun `test session layout constants provide shared geometry`() {
        assertTrue(JBUI.scale(SessionUiStyle.SessionLayout.GAP) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.Layout.GAP) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING) > 0)
        assertTrue(SessionUiStyle.View.Tool.BODY_LINES > 0)
        assertEquals(5, SessionUiStyle.View.Reasoning.BODY_LINES)
    }

    fun `test session status badges use shared styles`() {
        assertSame(UiStyle.Badge.SessionRunning, SessionActivityKind.RUNNING.style())
        assertSame(UiStyle.Badge.Primary, SessionActivityKind.QUESTION.style())
        assertSame(UiStyle.Badge.Primary, SessionActivityKind.PLAN.style())
        assertSame(UiStyle.Badge.Primary, SessionActivityKind.PERMISSION.style())
        assertSame(UiStyle.Badge.Primary, SessionActivityKind.LOGIN_REQUIRED.style())
    }

    fun `test pull request states use github badge styles`() {
        assertSame(UiStyle.Badge.PullRequestOpen, style(GhState.OPEN))
        assertSame(UiStyle.Badge.PullRequestDraft, style(GhState.DRAFT))
        assertSame(UiStyle.Badge.PullRequestMerged, style(GhState.MERGED))
        assertSame(UiStyle.Badge.PullRequestClosed, style(GhState.CLOSED))
    }
}
