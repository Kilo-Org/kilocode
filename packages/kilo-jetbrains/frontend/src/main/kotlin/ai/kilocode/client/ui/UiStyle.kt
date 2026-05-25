package ai.kilocode.client.ui

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
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

    /** Theme-aware colors and color math used by multiple UI surfaces. */
    object Colors {
        fun bg(): Color = UIUtil.getPanelBackground()

        fun fg(): Color = UIUtil.getLabelForeground()

        fun weak(): Color = UIUtil.getContextHelpForeground()

        /** Uses the editor background so chat cards feel native beside editor content. */
        fun editorBackground(): Color = JBColor.lazy { EditorColorsManager.getInstance().globalScheme.defaultBackground }

        /**
         * Card surface background: follows the active theme's text-field/input surface.
         * Uses [UIUtil.getTextFieldBackground] as the semantic platform surface color for
         * contained panels. Falls back to the panel background when unavailable.
         */
        fun cardBg(): Color = JBColor.lazy {
            UIManager.getColor("TextField.background") ?: UIUtil.getPanelBackground()
        }

        /** Standard picker/combobox surface, contrasted against the default panel background by the active theme. */
        fun picker(): Color = JBColor.lazy {
            UIManager.getColor("ComboBoxButton.background")
                ?: UIManager.getColor("ComboBox.nonEditableBackground")
                ?: UIUtil.getPanelBackground()
        }

        /** Filled badge surface using platform badge/info colors with a soft theme-derived fallback. */
        fun badgeBg(): Color = JBColor.lazy {
            UIManager.getColor("Badge.background")
                ?: UIManager.getColor("Label.infoBackground")
                ?: blend(cardBg(), fg(), 0.16f)
        }

        /** Filled badge text color paired with [badgeBg]. */
        fun badgeFg(): Color = JBColor(Color.BLACK, UIUtil.getLabelForeground())

        /** Card border color shared across profile cards. */
        fun cardBorder(): Color = JBColor.namedColor("Component.borderColor", JBColor.border())

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
    }
}
