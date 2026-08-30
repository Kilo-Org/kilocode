package ai.kilocode.client.onboarding.ui

import ai.kilocode.client.onboarding.OnboardingStep
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel

/** One read-only row in [OnboardingListCard]: title + summary text, no controls. */
internal class OnboardingStepRow : BorderLayoutPanel() {

    private val titleLabel = JBLabel().apply { font = UiStyle.Fonts.bold() }
    private val summaryLabel = JBLabel().apply { foreground = UiStyle.Colors.weak() }

    init {
        isOpaque = false
        border = JBUI.Borders.emptyBottom(UiStyle.Gap.sm())
        addToCenter(Stack.vertical(gap = UiStyle.Gap.xs()).next(titleLabel).next(summaryLabel))
    }

    fun update(step: OnboardingStep) {
        titleLabel.text = step.need.title
        summaryLabel.text = step.need.summary
    }
}
