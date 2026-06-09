package ai.kilocode.client.session.ui.style

import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import javax.swing.border.Border

/** Static style tokens owned by the chat session UI. */
object SessionUiStyle {
    /** Geometry for the transcript list and its scroll behavior. */
    object SessionLayout {
        const val GAP = 4
        const val TRANSCRIPT_PADDING = 12
        const val USER_PROMPT_INDENT = 100
        const val SCROLL_INCREMENT = 16
    }

    /** Shared tokens for individual transcript views and session views. */
    object View {
        const val SESSION_VIEW_GAP = 6
        const val SESSION_VIEW_VERTICAL_PADDING = 8
        const val SESSION_VIEW_HORIZONTAL_PADDING = 12
        const val SESSION_VIEW_BODY_EXTRA_HEIGHT = 16

        internal const val BORDER_DELTA = 80
        internal const val HOVER_BORDER_ALPHA = 0.18f
        internal const val HOVER_FILL_ALPHA = 0.10f

        /** Creates a visible separator against editor-derived transcript surfaces. */
        fun line(): Color = JBColor.lazy { UiStyle.Colors.contrast(UiStyle.Colors.editorBackground(), BORDER_DELTA) }

        fun transcript(): Color = UiStyle.Colors.bg()

        fun sessionViewBackground(): Color = UiStyle.Colors.contentBackground()

        fun sessionViewOutline(): Color = UiStyle.Colors.contentBorder()

        fun surface(): Color = UiStyle.Colors.editorBackground()

        fun header(): Color = UiStyle.Colors.editorBackground()

        /** Subtle hover fill, softer than the session-view outline. */
        fun headerHover(): Color = JBColor.lazy { UiStyle.Colors.blend(header(), hoverLine(), HOVER_FILL_ALPHA) }

        /** Subtle hover outline, stronger than the hover fill. */
        fun hoverLine(): Color = JBColor.lazy {
            UiStyle.Colors.blend(line(), JBUI.CurrentTheme.ActionButton.hoverBackground(), HOVER_BORDER_ALPHA)
        }

        fun sessionView(color: Color = line()): Border = outline(color)

        fun outline(color: Color = line()): Border = JBUI.Borders.customLine(color, 1)

        fun topOutline(): Border = JBUI.Borders.customLineTop(line())

        /** Prompt input dimensions and chrome inside the session view. */
        object Prompt {
            const val EDITOR_LINES = 3
            const val EDITOR_MAX_LINES = 8
            const val EDITOR_SPARE_LINES = 1
            const val EDITOR_CHROME = 16
            const val SEND_BUTTON_SIZE = 24
            const val CORNER_ARC = 6
            const val FOCUS_WIDTH = 2
            const val PANEL_VERTICAL_PADDING = 8
            const val PANEL_HORIZONTAL_PADDING = 12
            const val CONTROL_GAP = 4
            const val SHELL_VERTICAL_PADDING = 6
            const val SHELL_HORIZONTAL_PADDING = 8
        }

        /** Reasoning block preview sizing. */
        object Reasoning {
            const val BODY_LINES = 5
        }

        /** Message container roles and user bubble geometry. */
        object Message {
            const val USER_ROLE = "user"
            const val ASSISTANT_ROLE = "assistant"
            const val USER_BORDER_ARC = 8
            const val USER_BORDER_VERTICAL_PADDING = 8
            const val USER_BORDER_HORIZONTAL_PADDING = 12
        }

        /** Markdown code block geometry inside assistant messages. */
        object Code {
            const val BLOCK_GAP = 6
            const val MIN_ROWS = 1
            const val BORDER_WIDTH = 1
            const val VIEWPORT_TOP_PADDING = 6
            const val VIEWPORT_HORIZONTAL_PADDING = 8
            const val VIEWPORT_BOTTOM_PADDING = 0
            const val SCROLLBAR_HEIGHT = 12
            const val WIDTH_PADDING = 16

            fun topPadding(): Int = VIEWPORT_TOP_PADDING + SCROLLBAR_HEIGHT
        }

        /** Permission session-view command preview limits. */
        object Permission {
            const val COMMAND_LINES = 3
        }

        /** Tool session-view preview limits and state colors. */
        object Tool {
            const val BODY_LINES = 15
            const val PREVIEW_LIMIT = 20_000

            fun pending(): Color = UiStyle.Colors.weak()

            fun running(): Color = UiStyle.Colors.fg()

            fun completed(): Color = UiStyle.Colors.weak()

            fun error(): Color = UiStyle.Colors.errorLabelForeground()
        }
    }

    /** Limits for the empty-state recent sessions list. */
    object RecentSessions {
        const val LIMIT = 5
        const val DESCRIPTION_WIDTH = 250
    }

    /** Colors for timeline/activity indicators in the session header. */
    object Timeline {
        val READ: Color = JBColor.namedColor("Kilo.Session.Timeline.Read", Color(0x37, 0x94, 0xff))
        val WRITE: Color = JBColor.namedColor("Kilo.Session.Timeline.Write", Color(0x00, 0x7f, 0xd4))
        val TOOL: Color = JBColor.namedColor("Kilo.Session.Timeline.Tool", Color(0x00, 0x7a, 0xcc))
        val SUCCESS: Color = JBColor.namedColor("Label.successForeground", UIUtil.getLabelSuccessForeground())
        val ERROR: Color = JBColor.namedColor("Kilo.Session.Timeline.Error", UIUtil.getErrorForeground())
        val TEXT: Color = JBColor.namedColor("Kilo.Session.Timeline.Text", UIUtil.getContextHelpForeground())
        val STEP: Color = JBColor.namedColor("Kilo.Session.Timeline.Step", JBColor.border())
    }
}

/** Border presets for connection dock panel. */
object Dock {
    fun banner(): Border = JBUI.Borders.compound(
        JBUI.Borders.customLineTop(SessionUiStyle.View.line()),
        JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.lg(), 0, UiStyle.Gap.lg()),
    )!!
}
