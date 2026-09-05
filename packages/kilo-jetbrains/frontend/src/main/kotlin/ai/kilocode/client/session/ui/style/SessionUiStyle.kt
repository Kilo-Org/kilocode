package ai.kilocode.client.session.ui.style

import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.awt.Component
import java.awt.Font
import javax.swing.UIManager

/** Static style tokens owned by the chat session UI. */
object SessionUiStyle {
    /**
     * The session palette is driven by three authored keys; everything else is derived:
     * - [sessionBackground] paints the whole session backdrop (containers stay transparent over it).
     * - [codeBlockBackground] is the single raised surface (code blocks, tool/shell output, prompt bubble, prompt input).
     * - [foreground] is normal text and links; [Text.Secondary] owns secondary session text.
     */
    object Colors {
        /**
         * Recess applied to the raised editor surface to derive a distinct backdrop. Used both when
         * the panel-background key is missing and when the panel background is identical to the
         * raised surface (e.g. Islands Dark/Darcula), so the prompt bubble/input and other raised
         * surfaces still stand out. [UiStyle.Colors.contrast] lightens dark themes and darkens light
         * themes, matching how generic themes separate the backdrop from editor content.
         */
        private const val SESSION_DELTA = 8

        /**
         * Whole session backdrop: follows the panel (chrome) background, distinct from raised
         * surfaces. When the panel background matches the raised surface — so raised surfaces would
         * be invisible against it — the backdrop is shifted by [SESSION_DELTA] instead.
         *
         * Not a `namedColor`: `JBColor.namedColor` resolves through theme `"*"` wildcard rules by
         * suffix (`name.endsWith("background")`), so any theme with a `*.background` rule would
         * hijack this key and skip the fallback below. We read an exact override key ourselves and
         * otherwise compute the backdrop, wrapped in `JBColor.lazy` so it re-resolves on LaF changes.
         */
        fun sessionBackground(): Color = JBColor.lazy {
            UIManager.getColor("Kilo.Session.background") ?: run {
                val raised = codeBlockBackground()
                val panel = UIManager.getColor("Panel.background") ?: raised
                if (panel.rgb == raised.rgb) UiStyle.Colors.contrast(raised, SESSION_DELTA) else panel
            }
        }

        /** Single raised surface (code blocks, tool/shell output, prompt bubble, prompt input): the editor background. */
        fun codeBlockBackground(): Color = JBColor.namedColor(
            "Kilo.Session.codeBlockBackground",
            UiStyle.Colors.editorBackground(),
        )

        fun foreground(): Color = JBColor.namedColor(
            "Kilo.Session.foreground",
            UiStyle.Colors.fg(),
        )
    }

    /** Text roles used by session UI labels and transcript chrome. */
    object Text {
        object Secondary {
            private const val BACKGROUND_BLEND = 0.35f

            fun foreground(): Color = JBColor.lazy {
                UiStyle.Colors.blend(Colors.foreground(), Colors.sessionBackground(), BACKGROUND_BLEND)
            }

            fun font(style: SessionEditorStyle): Font = style.regularFont
        }
    }

    object Transcript {
        fun bgColor(): Color = Colors.sessionBackground()
    }

    /** Geometry for the transcript list and its scroll behavior. */
    object SessionLayout {
        const val READABLE_COLUMNS = 98
        const val GAP = 3
        const val USER_PROMPT_GAP = 10
        const val TRANSCRIPT_SCROLLBAR_PADDING = 10

        // Unscaled base transcript insets. Base 6 == UiStyle.Gap.md, base 4 == UiStyle.Gap.sm.
        // Left and right reserve scrollbar allowance to match the previous symmetric padding.
        const val INNER_TOP = 6
        const val INNER_BOTTOM = 4
        const val INNER_HORIZONTAL = 4 + TRANSCRIPT_SCROLLBAR_PADDING

        const val USER_PROMPT_INDENT = 100
        const val SCROLL_INCREMENT = 48

        fun readableWidth(component: Component, font: Font): Int {
            val width = component.getFontMetrics(font).charWidth('0').coerceAtLeast(1)
            return width * READABLE_COLUMNS
        }
    }

    /** Shared tokens for individual transcript views and session views. */
    object View {
        /**
         * Corner arc (unscaled) for raised session blocks: the user prompt bubble and the
         * collapsed card hover fill. Scale with [JBUI.scale] at the call site.
         */
        const val BLOCK_ARC = 8

        object Layout {
            const val GAP = 5
            const val VERTICAL_PADDING = 7
            /** Header vertical padding for the compact card variant (e.g. reasoning). */
            const val COMPACT_VERTICAL_PADDING = 5
            const val HORIZONTAL_PADDING = 12
            const val BODY_EXTRA_HEIGHT = 16
        }

        /**
         * Left inset for expanded card content that should read as nested under the header — the diff
         * body's filename row and the auto-approve rule rows both use it. Reuse this wherever expanded
         * content needs indenting so the amount stays consistent across cards.
         */
        fun contentIndent() = UiStyle.Gap.pad()

        /**
         * Standard transparent inset separating an expanded card header from its content, and
         * separating stacked content surfaces inside a [ai.kilocode.client.session.ui.SessionContentPanel].
         * Matches the gap between views in the transcript ([SessionLayout.GAP]), so a card's internal
         * spacing reads the same as the spacing between cards.
         */
        fun contentGap() = JBUI.scale(SessionLayout.GAP)

        /**
         * Single source of truth for the spacing of every session-card header (see `PartHeader`).
         * Keep header gaps here so all cards stay aligned; do not hardcode header spacing elsewhere.
         */
        object Header {
            /** Leading inset from the card edge to the first header element. */
            fun left() = JBUI.scale(Layout.HORIZONTAL_PADDING)

            /** Trailing inset from the collapse/expand arrow to the card edge. */
            fun right() = JBUI.scale(Layout.HORIZONTAL_PADDING)

            /** Gap between the leading glyph icon and the title. */
            fun icon() = UiStyle.Gap.sm()

            /** Universal gap between every element after the title. */
            fun gap() = JBUI.scale(Layout.GAP)

            /** Larger gap separating the title from the elements that follow it (one standard step above [gap]). */
            fun title() = UiStyle.Gap.lg()
        }

        object Popup {
            const val MAX_WIDTH = 350
            const val WIDE_MAX_WIDTH = MAX_WIDTH * 2
            const val MAX_HEIGHT = 450

            /**
             * Band kept above and below a body that scrolls sideways, so its scrollbar clears the
             * content instead of landing on the last line of it. Doubles the balloon's own 6px vertical
             * inset, because a body with a scrollbar is one whose first and last line would otherwise
             * sit against the balloon edge with a bar over them.
             */
            const val SCROLL_PADDING = 12
        }

        internal const val BORDER_DELTA = 80
        internal const val HOVER_BORDER_ALPHA = 0.18f
        internal const val HOVER_FILL_ALPHA = 0.10f

        object Surface {
            fun bgColor(): Color = Colors.sessionBackground()

            fun headerBgColor(): Color = Colors.sessionBackground()

            /** Subtle hover fill, softer than the session-view outline. */
            fun headerHoverBgColor(): Color = JBColor.lazy {
                UiStyle.Colors.blend(Colors.sessionBackground(), Outline.hoverColor(), HOVER_FILL_ALPHA)
            }
        }

        object Outline {
            fun color(): Color = UiStyle.Colors.contentBorder()

            fun brightColor(): Color = JBColor.lazy {
                UiStyle.Colors.contrast(Colors.sessionBackground(), BORDER_DELTA)
            }

            /** Subtle hover outline, stronger than the hover fill. */
            fun hoverColor(): Color = JBColor.lazy {
                UiStyle.Colors.blend(brightColor(), JBUI.CurrentTheme.ActionButton.hoverBackground(), HOVER_BORDER_ALPHA)
            }

            fun width(): Int = JBUI.scale(1)
        }

        /** Prompt input dimensions and chrome inside the session view. */
        object Prompt {
            fun bgColor(_style: SessionEditorStyle): Color = Colors.codeBlockBackground()

            const val EDITOR_LINES = 1
            const val EDITOR_CHROME = 16
            const val SEND_BUTTON_SIZE = 24
            const val CORNER_ARC = 10
            const val FOCUS_WIDTH = 2
            const val PANEL_VERTICAL_PADDING = 8
            const val PANEL_HORIZONTAL_PADDING = 12
            const val CONTROL_GAP = 4
            const val SHELL_VERTICAL_PADDING = 6
            const val SHELL_HORIZONTAL_PADDING = 8
            // Horizontal editor inset intentionally matches vertical shell padding to balance text and chrome.
            const val EDITOR_HORIZONTAL_INSET = SHELL_VERTICAL_PADDING

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
            const val CHIP_HEIGHT = 28
            const val CHIP_ICON_GAP = 6
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
                val bg = Colors.sessionBackground()
                Color(bg.red, bg.green, bg.blue, SCRIM_ALPHA)
            }

            fun card(): Color = UiStyle.Colors.contentBackground()
        }

        /** Reasoning block preview sizing. */
        object Reasoning {
            const val BODY_LINES = 5
            const val BODY_VERTICAL_PADDING = 4
            const val BODY_HORIZONTAL_PADDING = 8
        }

        /** Markdown colors that mirror Kilo's VS Code webview tokens. */
        object Markdown {
            fun string(): Color = JBColor.namedColor(
                "Kilo.Session.Markdown.String",
                JBColor(0xA31515, 0xCE9178),
            )
        }

        object Todo {
            fun checkBg(): Color = JBColor.namedColor("Kilo.Session.Todo.Checkbox.Background", Color.WHITE)

            fun checkFg(): Color = JBColor.namedColor("Kilo.Session.Todo.Checkbox.Foreground", Color(0x1F, 0x23, 0x28))

            fun checkBorder(): Color = UiStyle.Colors.contentBorder()
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
            const val VIEWPORT_HORIZONTAL_PADDING = Layout.HORIZONTAL_PADDING
            const val VIEWPORT_BOTTOM_PADDING = 6
            const val SCROLLBAR_HEIGHT = 12
            const val WIDTH_PADDING = 16

            fun topPadding(): Int = VIEWPORT_TOP_PADDING + UiStyle.Gap.lg()
        }

        object Diagram {
            const val MAX_HEIGHT = 480
            const val PADDING = 16
            const val EMPTY_HEIGHT = 96
        }

        /** Permission session-view command preview limits. */
        object Permission {
            const val COMMAND_LINES = 3
        }

        /** Outcome/error footer card preview limits. */
        object Outcome {
            const val ERROR_LINES = 5
        }

        /** Tool session-view preview limits and state colors. */
        object Tool {
            const val BODY_LINES = 15
            const val TASK_LINES = 10
            const val DIFF_LINES = 20
            const val PREVIEW_LIMIT = 20_000

            /**
             * Total unified-diff line count above which the hover popup and inline body stop building
             * embedded editors and show an "open in a diff tab" placeholder instead. Each embedded
             * editor holds the whole diff document, and reinitializing it walks every line on the EDT,
             * so an uncapped large diff freezes the UI. Above this the platform diff viewer (which
             * streams file diffs on background threads) handles it.
             */
            const val DIFF_MAX_LINES = 2_000

            fun pending(): Color = Text.Secondary.foreground()

            fun running(): Color = Colors.foreground()

            fun completed(): Color = Text.Secondary.foreground()

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
        val TEXT: Color = Text.Secondary.foreground()
        val STEP: Color = JBColor.namedColor("Kilo.Session.Timeline.Step", JBColor.border())
    }
}
