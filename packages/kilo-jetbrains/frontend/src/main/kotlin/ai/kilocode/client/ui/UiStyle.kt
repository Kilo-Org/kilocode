package ai.kilocode.client.ui

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.util.registry.Registry
import com.intellij.ui.ColorUtil
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
        /** Mirrors the platform default for `ide.balloon.shadow.size`, used only if the key is gone. */
        private const val SHADOW_SIZE = 24

        fun bg(): Color = UIUtil.getPanelBackground()

        fun border(): Color = JBUI.CurrentTheme.Popup.borderColor(true)

        /** New UI parameter-info balloon insets: symmetric vertical padding with wider sides. */
        fun insets() = JBUI.insets(6, 12, 6, 12)

        fun pointer() = JBUI.size(16, 8)

        fun arc() = JBUI.scale(8)

        /**
         * Drop-shadow inset the platform reserves on every side of a balloon, or 0 when shadows are
         * off. Read from the same registry keys `BalloonImpl` uses, because callers that size a
         * balloon to fit an area have to account for it: an overflowing balloon is silently
         * re-pointed to another side.
         */
        fun shadow(): Int =
            if (Registry.`is`("ide.balloon.shadowEnabled", true)) {
                JBUI.scale(Registry.intValue("ide.balloon.shadow.size", SHADOW_SIZE))
            } else {
                0
            }
    }

    /** Filled badge styles shared across JetBrains UI surfaces. */
    object Badge {
        private const val PR_SOFT_ALPHA = 0.15

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

        object ActivityRunning : Style {
            override fun bg(): Color = JBColor.namedColor(
                "Kilo.Activity.runningBackground",
                JBColor(Color(0x55, 0xA7, 0x6A), Color(0x57, 0x96, 0x5C)),
            )

            override fun fg(): Color = JBColor.namedColor(
                "Kilo.Activity.runningForeground",
                Color.WHITE,
            )
        }

        object ActivityAttention : Style {
            override fun bg(): Color = JBColor.namedColor(
                "Kilo.Activity.attentionBackground",
                JBColor(Color(0xE6, 0x6D, 0x17), Color(0xC7, 0x7D, 0x55)),
            )

            override fun fg(): Color = JBColor.namedColor(
                "Kilo.Activity.attentionForeground",
                Color.WHITE,
            )
        }

        object ActivityError : Style {
            override fun bg(): Color = JBColor.namedColor(
                "Kilo.Activity.errorBackground",
                JBColor(Color(0xE5, 0x57, 0x65), Color(0xDB, 0x5C, 0x5C)),
            )

            override fun fg(): Color = JBColor.namedColor(
                "Kilo.Activity.errorForeground",
                Color.WHITE,
            )
        }

        object PullRequestOpen : Style {
            private val accent = JBColor.namedColor(
                "Kilo.PullRequest.openBadgeForeground",
                JBColor(Color(0x1A, 0x7F, 0x37), Color(0x3F, 0xB9, 0x50)),
            )

            override fun bg(): Color = ColorUtil.withAlpha(accent, PR_SOFT_ALPHA)

            override fun fg(): Color = accent
        }

        object PullRequestDraft : Style {
            private val accent = JBColor.namedColor(
                "Kilo.PullRequest.draftBadgeForeground",
                JBColor(Color(0x59, 0x63, 0x6E), Color(0x91, 0x98, 0xA1)),
            )

            override fun bg(): Color = ColorUtil.withAlpha(accent, PR_SOFT_ALPHA)

            override fun fg(): Color = accent
        }

        object PullRequestMerged : Style {
            private val accent = JBColor.namedColor(
                "Kilo.PullRequest.mergedBadgeForeground",
                JBColor(Color(0x82, 0x50, 0xDF), Color(0xA3, 0x71, 0xF7)),
            )

            override fun bg(): Color = ColorUtil.withAlpha(accent, PR_SOFT_ALPHA)

            override fun fg(): Color = accent
        }

        object PullRequestClosed : Style {
            private val accent = JBColor.namedColor(
                "Kilo.PullRequest.closedBadgeForeground",
                JBColor(Color(0xCF, 0x22, 0x2E), Color(0xF8, 0x51, 0x49)),
            )

            override fun bg(): Color = ColorUtil.withAlpha(accent, PR_SOFT_ALPHA)

            override fun fg(): Color = accent
        }
    }

    /** Theme-aware colors and color math used by multiple UI surfaces. */
    object Colors {
        fun bg(): Color = UIUtil.getPanelBackground()

        fun fg(): Color = UIUtil.getLabelForeground()

        fun weak(): Color = UIUtil.getContextHelpForeground()

        // Neutral icon greys from the New UI palette: the same values our svg row icons paint with, so
        // an animated icon reads at the row's icon weight instead of as a colored status light. Each
        // variant carries the contrast its own theme needs — mid grey on light, near-white on dark.
        val runningLight = Color(0x6C, 0x70, 0x7E)
        val runningDark = Color(0xCE, 0xD0, 0xD6)

        fun running(): Color = JBColor.namedColor(
            "Kilo.Activity.runningSpinnerForeground",
            JBColor(runningLight, runningDark),
        )

        /** Uses the editor background so chat cards feel native beside editor content. */
        fun editorBackground(): Color = JBColor.lazy { EditorColorsManager.getInstance().globalScheme.defaultBackground }

        /** Background for code fragments when a caller explicitly wants the editor scheme's doc-code style. */
        fun codeBlockBackground(scheme: EditorColorsScheme): Color =
            scheme.getAttributes(DefaultLanguageHighlighterColors.DOC_CODE_BLOCK)?.backgroundColor ?: scheme.defaultBackground

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

        fun addedForeground(): Color = JBColor.namedColor(
            "Kilo.DiffStat.addedForeground",
            JBColor(Color(0x1f, 0x9d, 0x66), Color(0x35, 0xd4, 0x9a)),
        )

        fun removedForeground(): Color = JBColor.namedColor(
            "Kilo.DiffStat.removedForeground",
            JBColor(Color(0xdb, 0x58, 0x66), Color(0xff, 0x6b, 0x7a)),
        )

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
