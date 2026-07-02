package ai.kilocode.client.session.ui.style

import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.awt.Insets

/** Static style tokens owned by the chat session UI. */
object SessionUiStyle {
    object Transcript {
        fun bgColor(): Color = UiStyle.Colors.bg()
    }

    /** Geometry for the transcript list and its scroll behavior. */
    object SessionLayout {
        const val GAP = 3
        val InnerInsets = Insets(UiStyle.Gap.md(), UiStyle.Gap.md(), UiStyle.Gap.sm(), UiStyle.Gap.sm())
        const val TRANSCRIPT_SCROLLBAR_PADDING = 10
        const val USER_PROMPT_INDENT = 100
        const val SCROLL_INCREMENT = 48
    }

    /** Shared tokens for individual transcript views and session views. */
    object View {
        object Layout {
            const val GAP = 5
            const val VERTICAL_PADDING = 7
            const val HORIZONTAL_PADDING = 12
            const val BODY_EXTRA_HEIGHT = 16
        }

        internal const val BORDER_DELTA = 80
        internal const val HOVER_BORDER_ALPHA = 0.18f
        internal const val HOVER_FILL_ALPHA = 0.10f

        object Surface {
            fun bgColor(): Color = UiStyle.Colors.editorBackground()

            fun headerBgColor(): Color = UiStyle.Colors.editorBackground()

            /** Subtle hover fill, softer than the session-view outline. */
            fun headerHoverBgColor(): Color = JBColor.lazy {
                UiStyle.Colors.blend(headerBgColor(), Outline.hoverColor(), HOVER_FILL_ALPHA)
            }
        }

        object Outline {
            fun color(): Color = UiStyle.Colors.contentBorder()

            fun brightColor(): Color = JBColor.lazy {
                UiStyle.Colors.contrast(UiStyle.Colors.editorBackground(), BORDER_DELTA)
            }

            /** Subtle hover outline, stronger than the hover fill. */
            fun hoverColor(): Color = JBColor.lazy {
                UiStyle.Colors.blend(brightColor(), JBUI.CurrentTheme.ActionButton.hoverBackground(), HOVER_BORDER_ALPHA)
            }

            fun width(): Int = JBUI.scale(1)
        }

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

            fun separator(): Color = JBColor.namedColor(
                "EditorTabs.underTabsBorderColor",
                JBUI.CurrentTheme.EditorTabs.borderColor(),
            )
        }

        /** Attachment preview card geometry. */
        object Attachment {
            const val CARD_WIDTH = 80
            const val CARD_HEIGHT = 59
            const val CLOSE_SIZE = 18
            const val CORNER_ARC = 8
        }

        /** Full-session file drop overlay geometry and colors. */
        object DropOverlay {
            const val CARD_VERTICAL_PADDING = 16
            const val CARD_HORIZONTAL_PADDING = 20
            const val CARD_ARC = 12
            const val LABEL_GAP = 2
            const val ICON_GAP = 10
            private const val SCRIM_ALPHA = 210

            fun scrim(): Color = JBColor.lazy {
                val bg = UiStyle.Colors.bg()
                Color(bg.red, bg.green, bg.blue, SCRIM_ALPHA)
            }

            fun card(): Color = UiStyle.Colors.contentBackground()
        }

        /** Reasoning block preview sizing. */
        object Reasoning {
            const val BODY_LINES = 5
            const val HEADER_VERTICAL_PADDING = 5
            const val BODY_VERTICAL_PADDING = 4
            const val BODY_HORIZONTAL_PADDING = 8
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
            const val BLOCK_GAP = SessionLayout.GAP
            const val MIN_ROWS = 1
            const val BORDER_WIDTH = 1
            const val VIEWPORT_TOP_PADDING = 6
            const val VIEWPORT_HORIZONTAL_PADDING = 8
            const val VIEWPORT_BOTTOM_PADDING = 6
            const val SCROLLBAR_HEIGHT = 12
            const val WIDTH_PADDING = 16

            fun topPadding(): Int = VIEWPORT_TOP_PADDING
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

    object AccountPopup {
        fun bgColor(): Color = UiStyle.Colors.contentBackground()

        fun outlineColor(): Color = UiStyle.Colors.contentBorder()
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
