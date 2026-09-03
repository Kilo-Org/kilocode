package ai.kilocode.client.session.ui.header

import ai.kilocode.client.actions.ChatMoveToWorktreeAction
import ai.kilocode.client.actions.ChatNewWorktreeAction
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.ChangesPanel
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import java.awt.Component
import java.awt.Container
import java.awt.Point
import javax.swing.SwingUtilities

@Suppress("UnstableApiUsage")
class BranchDockTest : BasePlatformTestCase() {

    // ---- dock visibility ----

    fun `test dock visible with messages`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setHasMessages(true)
        }
        assertTrue(edt { dock.isVisible })
    }

    fun `test dock visible with changes`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = true, availability = GhAvailability.OK))
            dock.setChanges(listOf(DiffFileDto("src/A.kt", 2, 1)))
        }
        assertTrue(edt { dock.isVisible })
    }

    fun `test dock hidden with nothing to show`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "main", worktree = false, availability = GhAvailability.OK))
        }
        assertFalse(edt { dock.isVisible })
    }

    fun `test dock hidden when git missing`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "main", worktree = false, availability = GhAvailability.GIT_MISSING))
            dock.setHasMessages(true)
        }
        assertFalse(edt { dock.isVisible })
    }

    fun `test PR makes dock visible`() {
        val dock = dock()
        edt {
            dock.setBranch(
                BranchStatusDto(
                    branch = "feature-x",
                    worktree = true,
                    availability = GhAvailability.GIT_MISSING,
                    pr = WorktreePrDto("/repo", 7, GhState.OPEN, "https://pr/7", "Title"),
                ),
            )
        }
        assertTrue(edt { dock.isVisible })
    }

    fun `test PR title uses normal text in the tool window dock`() {
        val dock = dock()
        edt { dock.setBranch(prBranch()) }

        val title = edt { components(dock).filterIsInstance<SimpleColoredComponent>().single() }
        assertEquals(SimpleTextAttributes.STYLE_PLAIN, edt { firstAttrs(title).style })
    }

    fun `test PR state badge is vertically centered in the reserved dock row`() {
        val dock = dock()
        edt {
            dock.setBranch(prBranch())
            dock.setSize(500, dock.preferredSize.height)
            layout(dock)
        }

        val badge = edt { components(dock).filterIsInstance<JBLabel>().single { it.icon is FilledBadgeIcon } }
        val center = edt { SwingUtilities.convertPoint(badge, Point(0, 0), dock).y + badge.height / 2 }
        assertTrue(kotlin.math.abs(edt { dock.height / 2 } - center) <= 1)
    }

    // ---- active session ----

    fun `test dock hidden while session is busy`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setHasMessages(true)
        }
        assertTrue(edt { dock.isVisible })

        edt { dock.setBusy(true) }
        assertFalse(edt { dock.isVisible })

        edt { dock.setBusy(false) }
        assertTrue(edt { dock.isVisible })
    }

    fun `test dock hidden while busy with local changes`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setLocal(listOf(DiffFileDto("src/A.kt", 2, 1)))
            dock.setBusy(true)
        }
        assertFalse(edt { dock.isVisible })
    }

    fun `test dock keeps PR row while session is busy`() {
        val dock = dock()
        edt {
            dock.setBranch(
                BranchStatusDto(
                    branch = "feature-x",
                    worktree = false,
                    availability = GhAvailability.OK,
                    pr = WorktreePrDto("/repo", 7, GhState.OPEN, "https://pr/7", "Title"),
                ),
            )
            dock.setHasMessages(true)
            dock.setBusy(true)
        }
        assertTrue(edt { dock.isVisible })
    }

    fun `test move action hidden while session is busy`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setHasMessages(true)
            dock.setBusy(true)
        }
        assertFalse(update(ChatMoveToWorktreeAction(), dock).isVisible)
    }

    fun `test new worktree action hidden while session is busy`() {
        val dock = dockWithNewWorktree()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setHasMessages(true)
            dock.setBusy(true)
        }
        assertFalse(update(ChatNewWorktreeAction(), dock).isVisible)
    }

    // ---- Move to Worktree action ----

    fun `test move action visible with messages`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setHasMessages(true)
            dock.setHasSession(true)
        }
        val p = update(ChatMoveToWorktreeAction(), dock)
        assertTrue(p.isVisible)
        assertTrue(p.isEnabled)
        assertEquals(KiloBundle.message("session.dock.move"), p.text)
        assertEquals(KiloBundle.message("session.dock.move.tooltip.empty"), p.description)
    }

    fun `test move action visible with changes and no messages`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setLocal(listOf(DiffFileDto("src/A.kt", 2, 1)))
            dock.setHasSession(true)
        }
        val p = update(ChatMoveToWorktreeAction(), dock)
        assertTrue(p.isVisible)
        assertEquals(KiloBundle.message("session.dock.move.tooltip.one"), p.description)
    }

    fun `test move action visible with changes and no session`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setLocal(listOf(DiffFileDto("src/A.kt", 2, 1), DiffFileDto("src/B.kt", 1, 0)))
        }
        // A new sidebar session has no id until its first prompt; the local changes alone are worth
        // moving, so the action is offered with changes-only wording.
        val p = update(ChatMoveToWorktreeAction(), dock)
        assertTrue(p.isVisible)
        assertTrue(p.isEnabled)
        assertEquals(KiloBundle.message("session.dock.move.tooltip.changes.other", 2), p.description)
    }

    fun `test move action hidden with nothing to move`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
        }
        assertFalse(update(ChatMoveToWorktreeAction(), dock).isVisible)
    }

    fun `test move action hidden when git missing`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.GIT_MISSING))
            dock.setHasMessages(true)
        }
        assertFalse(update(ChatMoveToWorktreeAction(), dock).isVisible)
    }

    fun `test move action invokes callback`() {
        var moved = 0
        val dock = edt { BranchDock(openDiff = {}, onMove = { moved++ }) }
        val action = ChatMoveToWorktreeAction()
        val event = event(action, dock)
        edt { ActionUtil.updateAction(action, event) }
        edt { action.actionPerformed(event) }
        assertEquals(1, moved)
    }

    fun `test move action hidden without a move host`() {
        val dock = edt { BranchDock(openDiff = {}, onMove = null) }
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setHasMessages(true)
        }
        assertFalse(update(ChatMoveToWorktreeAction(), dock).isVisible)
    }

    // ---- New Worktree action ----

    fun `test new worktree action visible when dock active`() {
        val dock = dockWithNewWorktree()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setHasMessages(true)
        }
        val p = update(ChatNewWorktreeAction(), dock)
        assertTrue(p.isVisible)
        assertEquals(KiloBundle.message("session.dock.newWorktree"), p.text)
    }

    fun `test new worktree action hidden with nothing to show`() {
        val dock = dockWithNewWorktree()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
        }
        assertFalse(update(ChatNewWorktreeAction(), dock).isVisible)
    }

    fun `test new worktree action hidden without callback`() {
        val dock = dock()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", worktree = false, availability = GhAvailability.OK))
            dock.setHasMessages(true)
        }
        assertFalse(update(ChatNewWorktreeAction(), dock).isVisible)
    }

    fun `test new worktree action invokes callback`() {
        var fired = 0
        val dock = edt { BranchDock(openDiff = {}, onMove = {}, onNewWorktree = { fired++ }) }
        val action = ChatNewWorktreeAction()
        val event = event(action, dock)
        edt { ActionUtil.updateAction(action, event) }
        edt { action.actionPerformed(event) }
        assertEquals(1, fired)
    }

    fun `test local only changes enable both actions without displaying a summary`() {
        val dock = dockWithNewWorktree()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", availability = GhAvailability.OK))
            dock.setLocal(listOf(DiffFileDto("rename.kt", 0, 0)))
        }
        assertTrue(edt { dock.isVisible })
        assertTrue(update(ChatMoveToWorktreeAction(), dock).isEnabledAndVisible)
        assertTrue(update(ChatNewWorktreeAction(), dock).isEnabledAndVisible)
        assertEquals(1, edt { dock.changeCount() })
        assertTrue(edt { components(dock).filterIsInstance<ChangesPanel>().all { !it.isVisible } })
        edt { dock.setLocal(emptyList()) }
        assertFalse(edt { dock.isVisible })
        assertFalse(update(ChatMoveToWorktreeAction(), dock).isVisible)
    }

    fun `test base changes do not enable transfer actions or inflate local counts`() {
        val dock = dockWithNewWorktree()
        edt {
            dock.setBranch(BranchStatusDto(branch = "feature-x", availability = GhAvailability.OK))
            dock.setChanges(listOf(DiffFileDto("base.kt", 11, 3), DiffFileDto("binary.dat", 0, 0)))
        }
        assertTrue(edt { dock.isVisible })
        assertFalse(update(ChatMoveToWorktreeAction(), dock).isVisible)
        assertFalse(update(ChatNewWorktreeAction(), dock).isVisible)
        assertEquals(0, edt { dock.changeCount() })
        edt { dock.setLocal(listOf(DiffFileDto("local.kt", 99, 21))) }
        assertEquals(1, edt { dock.changeCount() })
        assertEquals(KiloBundle.message("session.dock.move.tooltip.changes.one"), update(ChatMoveToWorktreeAction(), dock).description)
        edt { dock.setChanges(emptyList()) }
        assertEquals(1, edt { dock.changeCount() })
        assertTrue(update(ChatMoveToWorktreeAction(), dock).isVisible)
    }

    // ---- header=false (worktree editor: branch, PR, and counts shown by the tab's own header) ----

    fun `test header false hides the PR row and its changes summary`() {
        val dock = dockNoHeader()
        edt {
            dock.setBranch(prBranch())
            dock.setChanges(listOf(DiffFileDto("base.kt", 11, 3)))
            dock.setLocal(listOf(DiffFileDto("src/A.kt", 2, 1)))
        }

        val core = edt { UIUtil.findComponentOfType(dock, PrHeaderView::class.java)!! }
        assertFalse(edt { core.isVisible })
    }

    fun `test header false keeps the dock hidden while busy even with a PR`() {
        // With header=true (test dock keeps PR row while session is busy) the PR keeps the dock
        // visible through a busy session; header=false has no PR row to fall back on, so busy hides
        // it exactly like a PR-less branch.
        val dock = dockNoHeader()
        edt {
            dock.setBranch(prBranch())
            dock.setHasMessages(true)
            dock.setBusy(true)
        }
        assertFalse(edt { dock.isVisible })
    }

    fun `test header false shows the action row for a branch with a PR`() {
        val dock = dockWithNewWorktreeNoHeader()
        edt {
            dock.setBranch(prBranch())
            dock.setHasMessages(true)
        }
        assertTrue(edt { dock.isVisible })
        assertTrue(update(ChatMoveToWorktreeAction(), dock).isVisible)
        assertTrue(update(ChatNewWorktreeAction(), dock).isVisible)
        val core = edt { UIUtil.findComponentOfType(dock, PrHeaderView::class.java)!! }
        assertFalse(edt { core.isVisible })
    }

    fun `test PR and standalone paths use compact retained summaries`() {
        val dock = dock()
        edt {
            dock.setChanges(listOf(DiffFileDto("base.kt", 5, 2)))
            dock.setLocal(listOf(DiffFileDto("local.kt", 99, 21)))
            val nodes = components(dock).filterIsInstance<ChangesPanel>()
            assertEquals(2, nodes.size)
            repeat(100) { n ->
                dock.setBranch(prBranch().copy(pr = if (n % 2 == 0) prBranch().pr else null))
                val shown = nodes.single { generateSequence(it as Component) { item -> item.parent }.all { item -> item.isVisible } }
                assertEquals(listOf("1 file", "-2", "+5"), components(shown).filterIsInstance<JBLabel>().filter { it.isVisible }.map { it.text })
                assertEquals(nodes, components(dock).filterIsInstance<ChangesPanel>())
            }
        }
    }

    private fun dock(): BranchDock = edt { BranchDock(openDiff = {}, onMove = {}) }

    private fun dockWithNewWorktree(): BranchDock = edt { BranchDock(openDiff = {}, onMove = {}, onNewWorktree = {}) }

    private fun dockNoHeader(): BranchDock = edt { BranchDock(openDiff = {}, onMove = {}, header = false) }

    private fun dockWithNewWorktreeNoHeader(): BranchDock =
        edt { BranchDock(openDiff = {}, onMove = {}, onNewWorktree = {}, header = false) }

    private fun prBranch() = BranchStatusDto(
        branch = "feature-x",
        worktree = true,
        availability = GhAvailability.OK,
        pr = WorktreePrDto("/repo", 7, GhState.OPEN, "https://pr/7", "Title"),
    )

    @RequiresEdt
    private fun firstAttrs(title: SimpleColoredComponent): SimpleTextAttributes {
        val iter = title.iterator()
        check(iter.hasNext()) { "missing title fragment" }
        iter.next()
        return iter.textAttributes
    }

    @RequiresEdt
    private fun layout(root: Component) {
        root.doLayout()
        if (root is Container) root.components.forEach(::layout)
    }

    @RequiresEdt
    private fun components(root: Component): List<Component> {
        val out = mutableListOf<Component>()
        fun visit(item: Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun update(action: AnAction, dock: BranchDock): Presentation {
        val event = event(action, dock)
        edt { ActionUtil.updateAction(action, event) }
        return event.presentation
    }

    private fun event(action: AnAction, dock: BranchDock): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val context = DataContext { id -> if (ChatDockKeys.DOCK.`is`(id)) dock else null }
        return AnActionEvent.createFromDataContext("", presentation, context)
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)
}
