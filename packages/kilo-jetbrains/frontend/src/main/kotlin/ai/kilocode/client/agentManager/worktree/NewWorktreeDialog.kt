package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.agentManager.AgentManagerDialog
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.foreignPr
import ai.kilocode.rpc.parsePrUrl
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBTextField
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.tabs.JBTabs
import com.intellij.ui.tabs.JBTabsFactory
import com.intellij.ui.tabs.JBTabsPosition
import com.intellij.ui.tabs.TabInfo
import com.intellij.ui.tabs.TabsListener
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Component
import java.awt.GridBagConstraints
import javax.swing.JComponent

private const val NAME_COLUMNS = 67

/** What the user confirmed in the New Worktree dialog. */
sealed interface NewWorktreePlan {
    data class Create(
        val branch: String,
        val base: String?,
        val prompt: PendingPrompt?,
        val fetchBase: Boolean = false,
    ) : NewWorktreePlan
    data class Branch(val branch: String) : NewWorktreePlan
    data class Pr(val url: String) : NewWorktreePlan
}

/**
 * The New Worktree dialog as seen by its caller: show it, then read what the user confirmed.
 * [result] stays null while the dialog is cancelled or its input never validates.
 */
interface NewWorktreeHandle {
    fun showAndGet(): Boolean
    fun result(): NewWorktreePlan?
}

/**
 * New Worktree dialog with parity to the VS Code Agent Manager dialog, split into three tabs:
 *
 * - **New** creates a branch: a worktree name (top), an initial prompt with the same mode / model /
 *   reasoning pickers as the chat prompt (center), and the branch name + base branch (bottom).
 *   Creating a worktree starts a session automatically with the prompt.
 * - **From PR** checks out a GitHub pull request by URL.
 * - **From Branch** checks out a local branch that no worktree holds yet.
 *
 * Both import tabs carry no initial prompt, so the worktree opens with an empty session. The
 * selected tab alone decides which input the OK button acts on.
 *
 * The dialog performs no worktree work itself — it records the confirmed [result] and closes; the
 * panel then drives the controller, so no view switch or worktree work runs while the modal dialog
 * still owns focus. Mode, model, and reasoning selections are persisted the same way the chat prompt
 * does, so the freshly-started session inherits them.
 */
internal class NewWorktreeDialog(
    parent: Component,
    project: Project,
    directory: String,
    private val suggestedName: String,
    private val defaultBase: String,
    private val branches: List<String>,
    // `owner/repo` for the checkout's origin remote; null when there is no GitHub origin. Used to
    // reject a pull request URL that belongs to a different repository before it is ever fetched.
    private val origin: String? = null,
    app: KiloAppService = service(),
    workspaces: KiloWorkspaceService = service(),
) : AgentManagerDialog(parent, project, directory, true, app, workspaces), NewWorktreeHandle {

    // Sizes the dialog: the name field is its widest fixed-width child.
    private val name = JBTextField(NAME_COLUMNS).apply {
        emptyText.text = KiloBundle.message("worktree.dialog.name.placeholder")
    }
    private val branch = JBTextField(suggestedName)
    private val base = BranchPicker(branches, defaultBase)
    private val fetch = JBCheckBox(
        KiloBundle.message("worktree.configure.fetchBase"),
        KiloPluginSettings.getFetchWorktreeBase(),
    )
    private val url = JBTextField().apply {
        emptyText.text = KiloBundle.message("worktree.import.pr.placeholder")
    }
    private val pick = BranchPicker(branches)
    private var tab = DialogTab.NEW

    private var plan: NewWorktreePlan? = null

    private var center: JComponent? = null

    init {
        if (pick.empty) pick.isEnabled = false
        title = KiloBundle.message("worktree.configure.title")
        init()
        setOKButtonText(KiloBundle.message("worktree.dialog.create"))
    }

    override fun createCenterPanel(): JComponent = tabs().also { center = it }

    /** The built content, so tests can drive the real Swing tree before the dialog is shown. */
    internal fun centerComponent(): JComponent = center ?: error("center panel not built")

    override fun result(): NewWorktreePlan? = plan

    override fun getPreferredFocusedComponent(): JComponent = focus()

    // Versioned: DialogWrapper persists the size per key, so a stale entry would keep the old width.
    override fun getDimensionServiceKey(): String = "ai.kilocode.NewWorktreeDialog.v3"

    override fun doOKAction() = submit()

    internal fun submit() {
        setErrorText(null)
        when (tab) {
            DialogTab.PR -> submitPr()
            DialogTab.BRANCH -> submitBranch()
            DialogTab.NEW -> submitCreate(prompt.text())
        }
    }

    private fun tabs(): JComponent {
        val fresh = TabInfo(newContent()).setText(KiloBundle.message("worktree.dialog.tab.new"))
        // Importing a PR needs gh, which is exactly what the GitHub integration setting turns off,
        // so the tab is omitted rather than offered as a guaranteed failure.
        val pr = if (KiloPluginSettings.getGithub()) TabInfo(prContent()).setText(KiloBundle.message("worktree.dialog.tab.pr")) else null
        val local = TabInfo(branchContent()).setText(KiloBundle.message("worktree.dialog.tab.branch"))
        val tabs: JBTabs = JBTabsFactory.createTabs(project, disposable).apply {
            presentation.setSingleRow(true)
            presentation.setTabsPosition(JBTabsPosition.top)
            presentation.showBorder = false
            addTab(fresh).setPreferredFocusableComponent(prompt.defaultFocusedComponent)
            pr?.let { addTab(it).setPreferredFocusableComponent(url) }
            addTab(local).setPreferredFocusableComponent(pick)
            addListener(object : TabsListener {
                override fun beforeSelectionChanged(oldSelection: TabInfo?, newSelection: TabInfo?) {
                    // JBTabs defers removing the old body while focus settles, and that body keeps
                    // its previous bounds. Hide it before layout so stale content cannot paint over
                    // the newly selected tab.
                    newSelection?.component?.isVisible = true
                    oldSelection?.component?.isVisible = false
                }

                override fun selectionChanged(oldSelection: TabInfo?, newSelection: TabInfo?) {
                    tab = when {
                        newSelection === pr -> DialogTab.PR
                        newSelection === local -> DialogTab.BRANCH
                        else -> DialogTab.NEW
                    }
                    setOKButtonText(KiloBundle.message(if (tab == DialogTab.NEW) "worktree.dialog.create" else "worktree.dialog.import"))
                    ui { focus().requestFocusInWindow() }
                }
            }, disposable)
        }
        return tabs.component
    }

    private fun newContent(): JComponent = content(name, fields())

    private fun prContent(): JComponent = importContent(SettingsStackedRow(
        KiloBundle.message("worktree.import.pr.section"),
        description = KiloBundle.message("worktree.import.pr.description"),
        value = url,
    ))

    private fun branchContent(): JComponent = importContent(SettingsStackedRow(
        KiloBundle.message("worktree.import.branch.section"),
        description = KiloBundle.message(if (pick.empty) "worktree.import.branch.empty" else "worktree.import.branch.description"),
        value = pick,
    ))

    private fun importContent(row: JComponent): JComponent {
        val body = BaseContentPanel().apply {
            border = JBUI.Borders.empty(UiStyle.Gap.pad(), UiStyle.Gap.sm(), UiStyle.Gap.pad(), UiStyle.Gap.sm())
        }
        body.next(SettingsRows().row(row))
        // Pinned to the top: the import forms are shorter than the New tab, which sizes the dialog.
        return BorderLayoutPanel().apply { addToTop(body) }
    }

    // A FormBuilder that stretches every field to the full width, so the base-branch combo matches
    // the name field and prompt above it.
    private fun fields(): JComponent = object : FormBuilder() {
        override fun getFill(component: JComponent) = GridBagConstraints.HORIZONTAL
    }
        .addLabeledComponent(KiloBundle.message("worktree.configure.branch"), branch)
        .addLabeledComponent(KiloBundle.message("worktree.configure.base"), base)
        .addComponent(fetch)
        .panel

    private fun validBase(value: String?): Boolean {
        if (base.known(value)) return true
        KiloNotifications.error(
            project,
            KiloBundle.message("worktree.configure.base.invalid.title"),
            KiloBundle.message("worktree.configure.base.invalid.content", value.orEmpty()),
        )
        base.focusText()
        return false
    }

    override fun submitCreate(text: String) {
        val explicit = branch.text.trim()
        val resolved = explicit.ifEmpty { name.text.trim() }.ifEmpty { suggestedName }
        val target = base.resolve()
        if (!validBase(target)) return
        KiloPluginSettings.setFetchWorktreeBase(fetch.isSelected)
        plan = NewWorktreePlan.Create(resolved, target, pending(text), fetch.isSelected)
        close(OK_EXIT_CODE)
    }

    private fun submitPr() {
        val value = url.text.trim()
        if (value.isEmpty()) {
            setErrorText(KiloBundle.message("worktree.import.pr.required"), url)
            url.requestFocusInWindow()
            return
        }
        val ref = parsePrUrl(value)
        if (ref == null) {
            setErrorText(KiloBundle.message("worktree.import.pr.invalid"), url)
            url.requestFocusInWindow()
            url.selectAll()
            return
        }
        val slug = "${ref.owner}/${ref.repo}"
        if (foreignPr(slug, origin)) {
            setErrorText(KiloBundle.message("worktree.import.pr.foreign", slug, origin.orEmpty()), url)
            url.requestFocusInWindow()
            url.selectAll()
            return
        }
        plan = NewWorktreePlan.Pr(value)
        close(OK_EXIT_CODE)
    }

    private fun submitBranch() {
        val target = pick.resolve()
        if (target == null || !pick.known(target)) {
            setErrorText(KiloBundle.message("worktree.import.branch.invalid"), pick)
            pick.focusText()
            return
        }
        plan = NewWorktreePlan.Branch(target)
        close(OK_EXIT_CODE)
    }

    private fun focus(): JComponent = when (tab) {
        DialogTab.PR -> url
        DialogTab.BRANCH -> pick
        DialogTab.NEW -> prompt.defaultFocusedComponent
    }

    private enum class DialogTab { NEW, PR, BRANCH }
}
