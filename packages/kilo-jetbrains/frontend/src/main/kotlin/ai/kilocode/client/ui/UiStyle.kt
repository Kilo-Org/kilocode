package ai.kilocode.client.ui

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.UIManager
import javax.swing.border.Border

/** Static UI tokens and helpers for JetBrains session Swing surfaces. */
object UiStyle {
    object Size {
        const val WIDTH = 350
        const val LIMIT = 5
        const val LINES = 3
        const val CHROME = 16
        const val BUTTON_WIDTH = 28
        const val BUTTON = 24
        const val SCROLL = 16
        const val USER_PROMPT = 100
        const val TOOL_BODY = 20_000

        fun userPromptMin(): Int = JBUI.scale(USER_PROMPT)

        fun toolBodyLimit(): Int = TOOL_BODY
    }

    object Space {
        const val XS = 2
        const val SM = 4
        const val MD = 6
        const val LG = 8
        const val PAD = 12
        const val LOGO = 14
        const val RECENT = 28
    }

    object Colors {
        internal const val BORDER_DELTA = 64
        internal const val HOVER_ALPHA = 0.35f

        fun bg(): Color = UIUtil.getPanelBackground()

        fun fg(): Color = UIUtil.getLabelForeground()

        fun weak(): Color = UIUtil.getContextHelpForeground()

        /** Creates a visible separator against editor-derived transcript surfaces. */
        fun line(): Color = JBColor.lazy { contrast(panel(), BORDER_DELTA) }

        fun surface(): Color = panel()

        /** Uses the editor background so chat cards feel native beside editor content. */
        fun panel(): Color = JBColor.lazy { EditorColorsManager.getInstance().globalScheme.defaultBackground }

        fun panelHover(): Color = JBColor.lazy { blend(panel(), line(), HOVER_ALPHA) }

        fun header(): Color = panel()

        /** Local hover color for collapsible transcript card headers. */
        fun headerHover(): Color = panelHover()

        fun error(): Color = JBColor.namedColor("Label.errorForeground", UIUtil.getErrorForeground())

        fun warning(): Color = JBColor.lazy {
            UIManager.getColor("Component.warningFocusColor")
                ?: UIManager.getColor("Label.warningForeground")
                ?: UIUtil.getContextHelpForeground()
        }

        fun running(): Color = JBColor.namedColor("ProgressBar.foreground", UIUtil.getLabelForeground())

        fun picker(): Color = JBColor.lazy {
            UIManager.getColor("ComboBoxButton.background")
                ?: UIManager.getColor("ComboBox.nonEditableBackground")
                ?: UIUtil.getPanelBackground()
        }

        fun pickerHover(): Color = JBUI.CurrentTheme.ActionButton.hoverBackground()

        internal fun contrast(base: Color, delta: Int): Color {
            val step = if (bright(base)) -delta else delta
            return Color(
                (base.red + step).coerceIn(0, 255),
                (base.green + step).coerceIn(0, 255),
                (base.blue + step).coerceIn(0, 255),
                base.alpha,
            )
        }

        internal fun blend(base: Color, over: Color, alpha: Float): Color {
            val inv = 1f - alpha
            return Color(
                (base.red * inv + over.red * alpha).toInt().coerceIn(0, 255),
                (base.green * inv + over.green * alpha).toInt().coerceIn(0, 255),
                (base.blue * inv + over.blue * alpha).toInt().coerceIn(0, 255),
                base.alpha,
            )
        }

        internal fun bright(color: Color): Boolean =
            (color.red * 0.299 + color.green * 0.587 + color.blue * 0.114) >= 128
    }

    object Insets {
        fun none(): java.awt.Insets = JBUI.emptyInsets()

        fun transcript(): java.awt.Insets = JBUI.insets(Space.PAD, Space.PAD, Space.PAD, Space.PAD)

        fun userPrompt(): Int = Size.userPromptMin()

        fun empty(): Border = JBUI.Borders.empty(Space.PAD)

        fun prompt(): Border = JBUI.Borders.empty(Space.LG, Space.PAD, Space.LG, Space.PAD)

        fun header(): Border = JBUI.Borders.empty(Space.LG, Space.LG)

        fun body(): Border = JBUI.Borders.empty(Space.LG, Space.PAD)
    }

    object Borders {
        fun card(): Border = cardBorder()

        fun cardBorder(): Border = JBUI.Borders.customLine(Colors.line(), 1)

        fun cardTop(): Border = JBUI.Borders.customLineTop(Colors.line())

        fun warning(): Border = JBUI.Borders.customLine(Colors.warning(), 1)

        fun picker(): Border = JBUI.Borders.empty(Space.XS, Space.LG)

        fun user(): Border = JBUI.Borders.compound(
            RoundedLineBorder(Colors.line(), JBUI.scale(Space.LG)),
            JBUI.Borders.empty(Space.LG, Space.PAD),
        )!!

        fun assistant(): Border = JBUI.Borders.empty()
    }

    /** Shared geometry for collapsible transcript cards such as tools and reasoning. */
    object Card {
        const val LINES = 15
        const val REASONING_LINES = 5

        fun layout(): BorderLayout = Gap.layout(Space.MD)

        fun groupGap(): Int = Gap.small()

        fun headerInsets(): Border = JBUI.Borders.empty(Space.LG, Space.PAD)

        fun bodyInsets(): Border = JBUI.Borders.empty(Space.LG, Space.PAD)

        fun border(): Border = Borders.card()

        fun divider(): Border = Borders.cardTop()

        fun scrollChrome(): Int = JBUI.scale(Size.CHROME)
    }

    object Dock {
        fun banner(): Border = JBUI.Borders.compound(
            JBUI.Borders.customLineTop(Colors.line()),
            JBUI.Borders.empty(Space.SM, Space.LG, 0, Space.LG),
        )!!

        fun neutral(): Border = JBUI.Borders.compound(
            JBUI.Borders.customLine(Colors.line(), 1),
            JBUI.Borders.empty(Space.LG, Space.PAD),
        )!!

        fun warning(): Border = JBUI.Borders.compound(
            Borders.warning(),
            JBUI.Borders.empty(Space.LG, Space.PAD),
        )!!
    }

    object Gap {
        fun xs() = JBUI.scale(Space.XS)

        fun inline() = JBUI.scale(Space.MD)

        fun regular() = JBUI.scale(Space.LG)

        fun small() = JBUI.scale(Space.SM)

        fun turn() = JBUI.scale(Space.PAD)

        fun part() = JBUI.scale(Space.SM)

        fun scroll() = JBUI.scale(Size.SCROLL)

        fun layout(gap: Int = Space.LG) = BorderLayout(JBUI.scale(gap), 0)
    }

    object Buttons {
        class HoverIcon : JButton() {
            private var over = false

            init {
                isFocusable = false
                setRequestFocusEnabled(false)
                isContentAreaFilled = false
                isBorderPainted = false
                isOpaque = false
                border = JBUI.Borders.empty()
                addMouseListener(object : MouseAdapter() {
                    override fun mouseEntered(e: MouseEvent) {
                        sync(true)
                    }

                    override fun mouseExited(e: MouseEvent) {
                        sync(false)
                    }
                })
            }

            override fun getPreferredSize(): Dimension = JBUI.size(Size.BUTTON, Size.BUTTON)

            override fun getMinimumSize(): Dimension = preferredSize

            override fun getMaximumSize(): Dimension = preferredSize

            override fun paintComponent(g: Graphics) {
                if (isEnabled && over) paintHover(g)
                super.paintComponent(g)
            }

            private fun paintHover(g: Graphics) {
                val g2 = g.create() as Graphics2D
                try {
                    g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                    g2.color = JBUI.CurrentTheme.ActionButton.hoverBackground()
                    val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
                    g2.fillRoundRect(0, 0, width, height, arc, arc)
                } finally {
                    g2.dispose()
                }
            }

            private fun sync(value: Boolean) {
                if (over == value) return
                over = value
                repaint()
            }
        }

        fun icon(button: JButton) {
            button.isFocusable = false
            button.setRequestFocusEnabled(false)
            button.isContentAreaFilled = false
            button.isBorderPainted = false
            button.isOpaque = false
            button.border = JBUI.Borders.empty()
        }
    }

    object Pickers {
        open class Label : JBLabel() {
            private var over = false

            init {
                border = Borders.picker()
                background = Colors.picker()
                // The custom rounded fill needs parent background around the corners.
                isOpaque = false
                addMouseListener(object : MouseAdapter() {
                    override fun mouseEntered(e: MouseEvent) {
                        sync(true)
                    }

                    override fun mouseExited(e: MouseEvent) {
                        sync(false)
                    }
                })
            }

            override fun updateUI() {
                super.updateUI()
                border = Borders.picker()
                background = Colors.picker()
            }

            override fun paintComponent(g: Graphics) {
                val g2 = g.create() as Graphics2D
                try {
                    g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                    g2.color = if (isEnabled && over) Colors.pickerHover() else Colors.picker()
                    val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
                    g2.fillRoundRect(0, 0, width, height, arc, arc)
                } finally {
                    g2.dispose()
                }
                super.paintComponent(g)
            }

            private fun sync(value: Boolean) {
                if (over == value) return
                over = value
                repaint()
            }
        }
    }

    object Components {
        fun transparent(component: JComponent) {
            component.isOpaque = false
        }
    }
}
