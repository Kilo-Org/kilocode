package ai.kilocode.client.ui

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import javax.swing.AbstractButton
import javax.swing.JComponent
import javax.swing.UIManager

/** Shared Swing style tokens that are not tied to one session component. */
object UiStyle {

    /** DPI-aware spacing primitives used across custom Swing layouts. */
    object Gap {
        fun xs() = JBUI.scale(2)

        fun sm() = JBUI.scale(4)

        fun md() = JBUI.scale(6)

        fun lg() = JBUI.scale(8)

        fun pad() = JBUI.scale(12)

        fun xl() = JBUI.scale(16)
    }

    /** Theme-aware component geometry tokens. */
    object Arc {
        /** Standard component corner arc, matching the platform's `Component.arc` key. */
        fun component() = com.intellij.util.ui.JBValue.UIInteger("Component.arc", 8).get()
    }

    /** Platform balloon styling used by lightweight contextual overlays. */
    object Balloon {
        fun bg(): Color = UIUtil.getPanelBackground()

        fun border(): Color = JBUI.CurrentTheme.Popup.borderColor(true)

        /** New UI parameter-info balloon insets: symmetric vertical padding with wider sides. */
        fun insets() = JBUI.insets(6, 12, 6, 12)

        fun pointer() = JBUI.size(16, 8)

        fun arc() = JBUI.scale(8)
    }

    /** Filled badge styles shared across JetBrains UI surfaces. */
    object Badge {
        interface Style {
            fun bg(): Color

            fun fg(): Color
        }

        object Primary : Style {
            override fun bg(): Color = JBColor.namedColor(
                "Kilo.History.activityBadgeBackground",
                JBUI.CurrentTheme.Link.Foreground.ENABLED,
            )

            override fun fg(): Color = JBColor.namedColor(
                "Kilo.History.activityBadgeForeground",
                Color.WHITE,
            )
        }

        object Secondary : Style {
            override fun bg(): Color = JBColor.lazy {
                UIManager.getColor("Badge.background")
                    ?: UIManager.getColor("Label.infoBackground")
                    ?: Colors.blend(Colors.contentBackground(), Colors.fg(), 0.16f)
            }

            override fun fg(): Color = JBColor.lazy {
                UIManager.getColor("Badge.foreground")
                    ?: UIManager.getColor("Label.infoForeground")
                    ?: UIUtil.getLabelForeground()
            }
        }

        object Highlight : Style {
            override fun bg(): Color = JBColor.namedColor(
                "Kilo.ModelPicker.freeBadgeBackground",
                JBColor(0x95D6AC, 0x7FCA99),
            )

            override fun fg(): Color = JBColor.namedColor(
                "Kilo.ModelPicker.freeBadgeForeground",
                JBColor.WHITE,
            )
        }

        object Alert : Style {
            override fun bg(): Color = JBColor.namedColor(
                "Kilo.History.runningBadgeBackground",
                JBColor(0xF5C542, 0x7A5A00),
            )

            override fun fg(): Color = JBColor.namedColor(
                "Kilo.History.runningBadgeForeground",
                JBColor(Color.BLACK, Color.WHITE),
            )
        }
    }

    /** Theme-aware colors and color math used by multiple UI surfaces. */
    object Colors {
        fun bg(): Color = UIUtil.getPanelBackground()

        fun fg(): Color = UIUtil.getLabelForeground()

        fun weak(): Color = UIUtil.getContextHelpForeground()

        /** Uses the editor background so chat cards feel native beside editor content. */
        fun editorBackground(): Color = JBColor.lazy { EditorColorsManager.getInstance().globalScheme.defaultBackground }

        /**
         * Contained panel background: follows the active theme's text-field/input surface.
         * Falls back to the panel background when unavailable.
         */
        fun contentBackground(): Color = JBColor.lazy {
            UIManager.getColor("TextField.background") ?: UIUtil.getPanelBackground()
        }

        /** Standard picker/combobox surface, contrasted against the default panel background by the active theme. */
        fun picker(): Color = JBColor.lazy {
            UIManager.getColor("ComboBoxButton.background")
                ?: UIManager.getColor("ComboBox.nonEditableBackground")
                ?: UIUtil.getPanelBackground()
        }

        /** Border color shared across contained panels. */
        fun contentBorder(): Color = JBColor.namedColor("Component.borderColor", JBColor.border())

        /**
         * Floating panel background: white in light themes, black in dark themes.
         * Used for account switcher popup panels and any overlay panels that need
         * a high-contrast base distinct from the standard editor/sidebar background.
         */
        fun floatingPanel(): Color = JBColor.namedColor(
            "Kilo.FloatingPanel.background",
            JBColor(java.awt.Color.WHITE, java.awt.Color.BLACK),
        )

        fun errorLabelForeground(): Color = JBColor.namedColor("Label.errorForeground", UIUtil.getErrorForeground())

        fun warningLabelForeground(): Color = JBColor.lazy {
            UIManager.getColor("Component.warningFocusColor")
                ?: UIManager.getColor("Label.warningForeground")
                ?: UIUtil.getContextHelpForeground()
        }

        fun infoOverlayBackground(): Color = JBUI.CurrentTheme.NotificationInfo.backgroundColor()

        fun infoOverlayForeground(): Color = JBUI.CurrentTheme.NotificationInfo.foregroundColor()

        fun infoOverlayBorder(): Color = JBUI.CurrentTheme.NotificationInfo.borderColor()

        fun actionHoverBackground(): Color = JBUI.CurrentTheme.ActionButton.hoverBackground()

        fun errorOverlayBackground(): Color = JBUI.CurrentTheme.NotificationError.backgroundColor()

        fun errorOverlayForeground(): Color = JBUI.CurrentTheme.NotificationError.foregroundColor()

        fun errorOverlayBorder(): Color = JBUI.CurrentTheme.NotificationError.borderColor()

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

    /**
     * Platform typography tokens for use throughout the plugin.
     *
     * Use these instead of [java.awt.Font.deriveFont] with manual size multipliers.
     * All values delegate to [JBFont] helpers which scale with the platform default font.
     */
    object Fonts {
        /** Large display value, e.g. account balance. Maps to [JBFont.h1] bold. */
        fun display(): JBFont = JBFont.h1().asBold()

        /** Page/section heading, e.g. login card title. Maps to [JBFont.h3] bold. */
        fun heading(): JBFont = JBFont.h3().asBold()

        /** Prominent short content, e.g. device auth code. Maps to [JBFont.h2] bold. */
        fun large(): JBFont = JBFont.h2().asBold()

        /** Card/question header font — bold at heading level 4. */
        fun header(): JBFont = JBFont.h4().asBold()

        /** Hint or description font — plain regular size. */
        fun hint(): JBFont = JBFont.regular()

        /** Standard body/label text. */
        fun regular(): JBFont = JBFont.regular()

        /** Bold body/label text. */
        fun bold(): JBFont = JBFont.regular().asBold()

        /** Small secondary text, e.g. metadata labels. */
        fun small(): JBFont = JBFont.small()
    }

    /** Small component helpers that keep repeated Swing setup in one place. */
    object Components {
        fun transparent(vararg components: JComponent) {
            components.forEach { it.isOpaque = false }
        }

        fun actionForeground(enabled: Boolean): Color = if (enabled) {
            UIManager.getColor("Button.foreground") ?: UIUtil.getLabelForeground()
        } else {
            UIManager.getColor("Button.disabledText") ?: UIUtil.getContextHelpForeground()
        }

        fun actionBackground(): Color = UIManager.getColor("Button.background") ?: UIUtil.getPanelBackground()

        fun actionBorder() = JBUI.Borders.compound(
            JBUI.Borders.customLine(UIUtil.getBoundsColor()),
            JBUI.Borders.empty(Gap.sm(), Gap.pad()),
        )

        fun actionLabel(component: JComponent, enabled: Boolean = component.isEnabled) {
            component.foreground = actionForeground(enabled)
            component.background = actionBackground()
            component.border = actionBorder()
            component.isOpaque = true
        }

        fun actionButton(button: AbstractButton) {
            button.foreground = actionForeground(button.isEnabled)
            button.background = actionBackground()
            button.border = actionBorder()
            button.isOpaque = true
            button.isBorderPainted = true
            button.isContentAreaFilled = false
            button.isFocusPainted = false
        }
    }
}
