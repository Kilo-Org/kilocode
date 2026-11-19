package ai.kilocode.client.onboarding.ui

import ai.kilocode.client.onboarding.OnboardingController
import ai.kilocode.client.onboarding.OnboardingRunState
import ai.kilocode.client.onboarding.OnboardingStep
import ai.kilocode.client.onboarding.OnboardingStepView
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListItem
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.JBSplitter
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import javax.swing.Action
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Modal dialog that walks the user through every currently detected [OnboardingStep]: a step rail
 * on the left, the selected step's own [OnboardingStepView.component] on the right, and footer
 * buttons (`Later` / `Skip` / `Run` / `Next`) that act on the selected step.
 *
 * Navigation locks while the selected step is [OnboardingRunState.Running] so a half-applied step
 * cannot be abandoned via the rail, Escape, or the window close box.
 */
internal class OnboardingDialog(
    private val controller: OnboardingController,
    initial: List<OnboardingStep>,
    private val onClosed: () -> Unit,
) : DialogWrapper(true) {

    private class Entry(val step: OnboardingStep, val view: OnboardingStepView)

    // ModalityState.any(): this dialog is modal, so plain Dispatchers.EDT work would be queued
    // behind it and never run while it is open — the run-state watchers below would go dead and
    // Run/Next would never update as a step progresses.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.EDT + ModalityState.any().asContextElement())
    private val entries = linkedMapOf<String, Entry>()
    private val resolved = mutableSetOf<String>()

    /** A rail row: just the step title, in the shared list's standard bold weight. */
    private data class StepRow(
        override val key: String,
        override val title: String,
    ) : ActiveListItem

    // internal (not private): lets tests simulate real clicks/selection on the same live
    // components the dialog wires up, instead of adding test-only accessor methods.
    internal val rail = ActiveList(
        emptyText = "",
        showSearch = false,
        onCell = { _, _ -> },
        onSelect = { syncSelection() },
    )
    private val right = JPanel(BorderLayout())

    /**
     * Longer per-step explanation, shown above the selected step's own content.
     *
     * `setCopyable` is what switches [JBLabel] to its editor-pane path; `allowAutoWrapping` is only
     * honoured there, so both are needed for the text to wrap instead of ellipsizing.
     */
    internal val detail = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        border = JBUI.Borders.emptyBottom(UiStyle.Gap.lg())
        setCopyable(true)
        setAllowAutoWrapping(true)
    }

    internal val laterButton = button(KiloBundle.message("onboarding.button.later")) { onLater() }
    internal val skipButton = button(KiloBundle.message("onboarding.button.skip")) { onSkip() }
    internal val runButton = button(KiloBundle.message("onboarding.button.run"), primary = true) { onRun() }
    internal val nextButton = button(KiloBundle.message("onboarding.button.next"), primary = true) { onNext() }

    /** Retained footer row. Order matches the session list card's Skip All / Later / Start. */
    internal val footer = Stack.horizontal(gap = UiStyle.Gap.sm())
        .next(skipButton)
        .next(laterButton)
        .next(runButton)
        .next(nextButton)

    init {
        title = KiloBundle.message("onboarding.dialog.title")
        initial.forEach { step ->
            val provider = controller.provider(step.id) ?: return@forEach
            entries[step.id] = Entry(step, provider.view())
        }
        rail.update(entries.values.map { StepRow(it.step.id, it.step.need.title) })
        init()
        if (entries.isNotEmpty()) rail.select(entries.keys.first())
        watchEntries()
        syncSelection()
    }

    override fun createCenterPanel(): JComponent {
        rail.border = JBUI.Borders.customLineRight(UiStyle.Colors.contentBorder())
        rail.preferredSize = JBDimension(RAIL_WIDTH, DIALOG_HEIGHT)
        right.isOpaque = false
        right.border = JBUI.Borders.empty(UiStyle.Gap.pad())
        return JBSplitter(false, SPLIT_PROPORTION).apply {
            firstComponent = rail
            secondComponent = right
            splitterProportionKey = "Kilo.OnboardingDialog.splitter"
            preferredSize = JBDimension(DIALOG_WIDTH, DIALOG_HEIGHT)
        }
    }

    /**
     * Standard [DialogWrapper] banner slot (rendered above the center panel). Carries the Kilo
     * branding for the setup flow.
     */
    override fun createTitlePane(): JComponent {
        val label = JBLabel(
            KiloBundle.message("onboarding.dialog.title"),
            IconLoader.getIcon("/icons/kilo@20x20.svg", OnboardingDialog::class.java),
            SwingConstants.LEADING,
        ).apply {
            font = JBFont.h4()
            iconTextGap = UiStyle.Gap.sm()
        }
        return BorderLayoutPanel().apply {
            border = JBUI.Borders.merge(
                JBUI.Borders.empty(UiStyle.Gap.pad()),
                JBUI.Borders.customLineBottom(UiStyle.Colors.contentBorder()),
                true,
            )
            addToCenter(label)
        }
    }

    override fun createActions(): Array<Action> = emptyArray()

    override fun createSouthPanel(): JComponent = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.pad())
        add(footer, BorderLayout.EAST)
    }

    override fun getPreferredFocusedComponent(): JComponent = rail.preferredFocus()

    override fun getDimensionServiceKey(): String = "Kilo.OnboardingDialog"

    override fun doCancelAction() {
        if (isSelectedRunning()) return
        super.doCancelAction()
    }

    override fun dispose() {
        finishRuns()
        entries.values.forEach { (it.view.component as? Disposable)?.let(Disposer::dispose) }
        scope.cancel()
        onClosed()
        super.dispose()
    }

    /**
     * Finalizes every step that reached a terminal run state but was never left via `Next`.
     *
     * [OnboardingStepView.done] is what commits a finished step (for v5 migration: the finalize RPC
     * plus hide), and Escape / the window close box bypass `Next` entirely. Doing this on dispose
     * covers every exit path, so a step that already ran cannot be dismissed half-applied and then
     * re-offered.
     */
    @RequiresEdt
    private fun finishRuns() {
        entries.values.forEach { entry ->
            if (entry.step.id in resolved) return@forEach
            val state = entry.view.run.value
            if (state !is OnboardingRunState.Done && state !is OnboardingRunState.Failed) return@forEach
            resolved.add(entry.step.id)
            entry.view.done()
        }
    }

    private fun watchEntries() {
        entries.values.forEach { entry ->
            scope.launch {
                entry.view.run.collect {
                    if (selectedId() == entry.step.id) syncButtons()
                }
            }
            scope.launch {
                entry.view.ready.collect {
                    if (selectedId() == entry.step.id) syncButtons()
                }
            }
        }
    }

    private fun selectedId(): String? = rail.selected()?.key

    private fun selectedEntry(): Entry? = selectedId()?.let(entries::get)

    private fun isSelectedRunning(): Boolean = selectedEntry()?.view?.run?.value is OnboardingRunState.Running

    private fun syncSelection() {
        val entry = selectedEntry() ?: return
        right.removeAll()
        // The step's longer `detail` text lives here rather than in the session list card, which
        // only shows the short title.
        detail.text = entry.step.need.detail
        right.add(detail, BorderLayout.NORTH)
        right.add(entry.view.component, BorderLayout.CENTER)
        right.revalidate()
        right.repaint()
        syncButtons()
    }

    private fun syncButtons() {
        val entry = selectedEntry() ?: return
        val runState = entry.view.run.value
        val running = runState is OnboardingRunState.Running
        val doneOrFailed = runState is OnboardingRunState.Done || runState is OnboardingRunState.Failed
        laterButton.isVisible = !running && !doneOrFailed
        skipButton.isVisible = !running && !doneOrFailed
        runButton.isVisible = !doneOrFailed
        runButton.isEnabled = !running && entry.view.ready.value
        runButton.text = if (running) {
            KiloBundle.message("onboarding.button.running")
        } else {
            KiloBundle.message("onboarding.button.run")
        }
        nextButton.isVisible = doneOrFailed
        nextButton.text = if (isLastUnresolved(entry.step.id)) {
            KiloBundle.message("onboarding.button.finish")
        } else {
            KiloBundle.message("onboarding.button.next")
        }
        // Locked, not busy: the step's own content on the right already shows run progress, so the
        // rail must not paint a second spinner over it.
        rail.setLocked(running)
    }

    private fun isLastUnresolved(id: String): Boolean = entries.keys.none { it != id && it !in resolved }

    private fun onLater() {
        val entry = selectedEntry() ?: return
        controller.laterStep(entry.step.id)
        advance(entry.step.id)
    }

    private fun onSkip() {
        val entry = selectedEntry() ?: return
        controller.skipStep(entry.step.id)
        advance(entry.step.id)
    }

    @RequiresEdt
    private fun onRun() {
        selectedEntry()?.view?.start()
        // Sync immediately rather than waiting for the run-state flow round-trip so the button
        // disables the instant the click is handled, not a dispatch cycle later.
        syncButtons()
    }

    private fun onNext() {
        val entry = selectedEntry() ?: return
        entry.view.done()
        advance(entry.step.id)
    }

    private fun advance(fromId: String) {
        resolved.add(fromId)
        val next = entries.keys.firstOrNull { it !in resolved }
        if (next == null) {
            close(OK_EXIT_CODE)
            return
        }
        rail.select(next)
        syncSelection()
    }

    private fun button(text: String, primary: Boolean = false, action: () -> Unit): JButton {
        val btn = JButton(text)
        btn.isOpaque = false
        btn.putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, if (primary) true else null)
        btn.addActionListener { action() }
        return btn
    }

    private companion object {
        const val RAIL_WIDTH = 220
        const val DIALOG_WIDTH = 760
        const val DIALOG_HEIGHT = 520
        const val SPLIT_PROPORTION = 0.28f
    }
}
