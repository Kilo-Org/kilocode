package ai.kilocode.client.actions

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActionsKeys
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.DumbAware
import java.awt.datatransfer.StringSelection

/** Opens the pull request for the session directory's branch in the browser. */
class OpenSessionPrAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(SessionActionsKeys.ACTIONS)?.pr != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val pr = e.getData(SessionActionsKeys.ACTIONS)?.pr ?: return
        Telemetry.send("Session Action", mapOf("action" to "open_pr"))
        BrowserUtil.browse(pr.url)
    }
}

/**
 * Copies a human-readable pull request reference: `<title> - <url>`.
 *
 * The URL is used verbatim rather than parsed into `owner/repo#n`, so this works for any forge, not
 * just GitHub. [WorktreePrDto.title] defaults to an empty string, so a blank title falls back to the
 * PR number.
 */
class CopySessionPrRefAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(SessionActionsKeys.ACTIONS)?.pr != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val pr = e.getData(SessionActionsKeys.ACTIONS)?.pr ?: return
        Telemetry.send("Session Action", mapOf("action" to "copy_pr_ref"))
        CopyPasteManager.getInstance().setContents(StringSelection(reference(pr)))
    }

    internal companion object {
        fun reference(pr: WorktreePrDto): String {
            val label = pr.title.trim().takeIf { it.isNotEmpty() } ?: "#${pr.number}"
            return "$label - ${pr.url}"
        }
    }
}

/** Copies the session id. Hidden until the session exists, since it is created on the first prompt. */
class CopySessionIdAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(SessionActionsKeys.ACTIONS)?.id != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val id = e.getData(SessionActionsKeys.ACTIONS)?.id ?: return
        Telemetry.send("Session Action", mapOf("action" to "copy_session_id"))
        CopyPasteManager.getInstance().setContents(StringSelection(id))
    }
}

/** Copies the existing public share link. Visible only while the session is shared. */
class CopyShareLinkAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(SessionActionsKeys.ACTIONS)?.share != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val link = e.getData(SessionActionsKeys.ACTIONS)?.share ?: return
        Telemetry.send("Session Action", mapOf("action" to "copy_share_link"))
        CopyPasteManager.getInstance().setContents(StringSelection(link))
    }
}

/**
 * Shares or stops sharing the session. One item whose text flips on the current share state, matching
 * the TUI's `/share` and `/unshare` pair.
 *
 * Hidden until the session exists and for readonly hosts. The clipboard write and the result balloon
 * are owned by the session UI, which has the project and the coroutine scope.
 */
class ShareSessionAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        val actions = e.getData(SessionActionsKeys.ACTIONS)
        if (actions == null || actions.id == null || actions.readonly) {
            e.presentation.isEnabledAndVisible = false
            return
        }
        // Both branches assign: a Presentation is reused across update cycles, so falling through
        // would leave "Stop Sharing" behind after the session is unshared.
        val prefix = if (actions.share != null) "action.Kilo.Session.Share.stop" else "action.Kilo.Session.Share"
        e.presentation.isEnabledAndVisible = true
        e.presentation.text = KiloBundle.message("$prefix.text")
        e.presentation.description = KiloBundle.message("$prefix.description")
    }

    override fun actionPerformed(e: AnActionEvent) {
        val actions = e.getData(SessionActionsKeys.ACTIONS) ?: return
        if (actions.id == null || actions.readonly) return
        val shared = actions.share != null
        Telemetry.send("Session Action", mapOf("action" to if (shared) "unshare" else "share"))
        if (shared) actions.stopShare() else actions.startShare()
    }
}
