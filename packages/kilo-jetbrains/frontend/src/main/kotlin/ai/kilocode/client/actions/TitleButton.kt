package ai.kilocode.client.actions

import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.impl.ActionButtonWithText
import java.awt.Insets
import javax.swing.JComponent

/**
 * Renders [this] action as an [ActionButtonWithText] with optically balanced pill padding, for use
 * from [com.intellij.openapi.actionSystem.ex.CustomComponentAction.createCustomComponent]. Keeps
 * the platform's border, hover/pressed look, and presentation-driven updates.
 *
 * All spacing comes from [UiStyle.ToolbarButton], whose values follow IntelliJ's labelled toolbar
 * metrics. [TitleButtonTest] renders the real button and measures the painted pixels directly so
 * a future icon or font change that reopens the alignment fails the test instead of silently
 * drifting.
 */
internal fun AnAction.titleButton(presentation: Presentation, place: String): JComponent =
    object : ActionButtonWithText(this, presentation, place, ActionToolbar.DEFAULT_MINIMUM_BUTTON_SIZE) {
        override fun getMargins(): Insets = UiStyle.ToolbarButton.padding()

        override fun iconTextSpace(): Int = UiStyle.ToolbarButton.gap()
    }
