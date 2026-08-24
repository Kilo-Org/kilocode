package ai.kilocode.client.session.ui.header

import ai.kilocode.client.actions.ChatMoveToWorktreeAction
import ai.kilocode.client.actions.ChatNewWorktreeAction
import ai.kilocode.client.plugin.KiloBundle
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
            dock.setChanges(listOf(DiffFileDto("src/A.kt", 2, 1)))
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
            dock.setChanges(listOf(DiffFileDto("src/A.kt", 2, 1)))
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
            dock.setChanges(listOf(DiffFileDto("src/A.kt", 2, 1), DiffFileDto("src/B.kt", 1, 0)))
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

    private fun dock(): BranchDock = edt { BranchDock(openDiff = {}, onMove = {}) }

    private fun dockWithNewWorktree(): BranchDock = edt { BranchDock(openDiff = {}, onMove = {}, onNewWorktree = {}) }

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
