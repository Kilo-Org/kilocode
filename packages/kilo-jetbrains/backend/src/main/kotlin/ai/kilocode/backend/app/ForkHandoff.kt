package ai.kilocode.backend.app

import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto

/**
 * The hidden note handed to a freshly forked session.
 *
 * Mirrors packages/kilo-vscode/src/agent-manager/fork-handoff.ts, which is the source of truth for
 * the wording. The note is a synthetic user text part sent with `noReply`, so the agent reads it as
 * context on its next turn while the transcript never shows it and no turn starts from it.
 *
 * One difference from that file: it makes the directory optional because its sidebar caller may not
 * know one. Every JetBrains fork path forks into a known worktree path, so the directory lines are
 * unconditional here rather than carrying a branch nothing can reach.
 *
 * Used by every fork path: the session fork RPC and the Move to Worktree flow.
 */
object ForkHandoff {
    private val LOG = KiloLog.create(ForkHandoff::class.java)

    fun forkText(dir: String): String = listOf(
        "<system-reminder>",
        "This session was forked from an existing session in the current repository or worktree.",
        "Use this as the current working directory: $dir",
        "For this fork, this location supersedes any earlier repository or worktree location retained in the copied context.",
        "The prior conversation context was retained intentionally.",
        "The user may continue the same task, explore an alternative approach, or provide new instructions.",
        "Follow the user's next instruction as the direction for this fork, using retained context when relevant.",
        "</system-reminder>",
    ).joinToString("\n")

    /**
     * Records the handoff for the forked session [id] living in [dir]. A failure here must not fail
     * the fork itself: the forked session is already usable without the note.
     */
    fun record(chat: KiloBackendChatManager, id: String, dir: String) {
        val prompt = PromptDto(
            parts = listOf(PromptPartDto(type = "text", text = forkText(dir), synthetic = true)),
            noReply = true,
        )
        try {
            chat.prompt(id, dir, prompt)
        } catch (e: Exception) {
            LOG.warn("${ChatLogSummary.sid(id)} kind=fork handoff=false message=${e.message}", e)
        }
    }
}
