package ai.kilocode.client.ui

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.JBColor
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

        fun md() = JBUI.scale(6)

        fun lg() = JBUI.scale(8)

        fun sm() = JBUI.scale(4)

        fun pad() = JBUI.scale(12)
    }

    /** Theme-aware colors and color math used by multiple UI surfaces. */
    object Colors {
        fun bg(): Color = UIUtil.getPanelBackground()

        fun fg(): Color = UIUtil.getLabelForeground()

        fun weak(): Color = UIUtil.getContextHelpForeground()

        /** Uses the editor background so chat cards feel native beside editor content. */
        fun editorBackground(): Color = JBColor.lazy { EditorColorsManager.getInstance().globalScheme.defaultBackground }

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

    /** Small component helpers that keep repeated Swing setup in one place. */
    object Components {
        fun transparent(vararg components: JComponent) {
            components.forEach { it.isOpaque = false }
        }
    }
}
