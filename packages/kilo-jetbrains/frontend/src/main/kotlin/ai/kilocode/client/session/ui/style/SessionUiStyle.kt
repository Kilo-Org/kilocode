package ai.kilocode.client.session.ui.style

import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.JBUI.Borders.customLine
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

    /** Shared tokens for individual transcript views and cards. */
    object View {
        const val CARD_LAYOUT_GAP = 6
        const val CARD_VERTICAL_PADDING = 8
        const val CARD_HORIZONTAL_PADDING = 12
        const val CARD_BODY_EXTRA_HEIGHT = 16

        internal const val BORDER_DELTA = 64
        internal const val HOVER_ALPHA = 0.35f

        /** Creates a visible separator against editor-derived transcript surfaces. */
        fun line(): Color = JBColor.lazy { UiStyle.Colors.contrast(UiStyle.Colors.editorBackground(), BORDER_DELTA) }

        fun surface(): Color = UiStyle.Colors.editorBackground()

        fun header(): Color = UiStyle.Colors.editorBackground()

        /** Local hover color for collapsible transcript card headers. */
        fun headerHover(): Color = JBColor.lazy { UiStyle.Colors.blend(header(), line(), HOVER_ALPHA) }

        fun card(): Border = cardBorder()

        fun cardBorder(): Border = JBUI.Borders.customLine(line(), 1)

        fun cardTop(): Border = JBUI.Borders.customLineTop(line())

        /** Prompt input dimensions and chrome inside the session view. */
        object Prompt {
            const val EDITOR_LINES = 3
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

        /** Tool card preview limits and state colors. */
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
        val READ: Color = JBColor(Color(0x37, 0x94, 0xff), Color(0x37, 0x94, 0xff))
        val WRITE: Color = JBColor(Color(0x00, 0x7f, 0xd4), Color(0x00, 0x7f, 0xd4))
        val TOOL: Color = JBColor(Color(0x00, 0x7a, 0xcc), Color(0x00, 0x7a, 0xcc))
        val SUCCESS: Color = JBColor.namedColor("Label.successForeground", UIUtil.getLabelSuccessForeground())
        val ERROR: Color = JBColor(Color(0xf4, 0x87, 0x71), Color(0xf4, 0x87, 0x71))
        val TEXT: Color = JBColor(Color(0x9d, 0x9d, 0x9d), Color(0x9d, 0x9d, 0x9d))
        val STEP: Color = JBColor(Color(0x4d, 0x4d, 0x4d), Color(0x4d, 0x4d, 0x4d))
    }
}

/** Border presets for question, permission, and connection dock panels. */
object Dock {
    fun banner(): Border = JBUI.Borders.compound(
        JBUI.Borders.customLineTop(SessionUiStyle.View.line()),
        JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.lg(), 0, UiStyle.Gap.lg()),
    )!!

    fun neutral(): Border = JBUI.Borders.compound(
        JBUI.Borders.customLine(SessionUiStyle.View.line(), 1),
        JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.pad()),
    )!!

    fun warning(): Border = JBUI.Borders.compound(
        customLine(UiStyle.Colors.warningLabelForeground(), 1),
        JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.pad()),
    )!!
}
