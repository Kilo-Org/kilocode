package ai.kilocode.client.agentManager.worktree

import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeStatsDto

/**
 * Renders the worktree-health report shown by the Advanced settings action.
 *
 * Sections and their order match the VS Code extension's diagnostics command, so a report from
 * either client reads the same way and can be compared directly in an issue. Pure string building:
 * the caller collects the data, this only formats it.
 */
internal object WorktreeDiagnostics {

    /** Everything the report needs, already fetched. */
    internal data class Input(
        val root: String,
        val gh: GhAvailability,
        val worktrees: List<WorktreeDto>,
        val orphans: List<String>,
        val stats: Map<String, WorktreeStatsDto>,
        val dirty: Map<String, WorktreeDirtyDto>,
    )

    fun render(input: Input): String {
        val lines = mutableListOf<String>()
        lines += "Kilo Agent Manager — worktree health"
        lines += "repository: ${input.root}"
        lines += ""

        lines += "tools"
        lines += "  git: ${if (input.gh == GhAvailability.GIT_MISSING) "NOT FOUND" else "ok"}"
        lines += "  gh:  ${ghLine(input.gh)}"
        lines += ""

        // "unavailable" means a poll could not measure the worktree — deliberately not folded into the
        // ok count, because that is exactly the conflation that made a failed poll look clean.
        val unavailable = input.worktrees.count { unavailable(input, it) }
        lines += "summary"
        lines += "  worktrees: ${input.worktrees.size}"
        lines += "  unavailable: $unavailable"
        lines += "  orphan directories: ${input.orphans.size}"
        lines += ""

        lines += "worktrees"
        if (input.worktrees.isEmpty()) lines += "  (none)"
        for (item in input.worktrees.sortedBy { !unavailable(input, it) }) {
            val key = normalizeWorktreePath(item.path)
            val state = if (unavailable(input, item)) "unavailable" else "ok"
            val reason = listOfNotNull(
                input.stats[key]?.reason?.takeIf { it.isNotBlank() },
                input.dirty[key]?.reason?.takeIf { it.isNotBlank() },
            ).firstOrNull()
            val detail = buildString {
                append("branch=${item.branch}")
                if (item.main) append(" main")
                if (item.locked) append(" locked")
                if (item.prunable) append(" prunable")
                if (reason != null) append(" reason=$reason")
            }
            lines += "  [$state] ${item.name} — ${item.path} ($detail)"
        }

        if (input.orphans.isNotEmpty()) {
            lines += ""
            lines += "orphan directories (nothing removes these automatically)"
            for (orphan in input.orphans) lines += "  $orphan"
        }
        return lines.joinToString("\n")
    }

    private fun unavailable(input: Input, item: WorktreeDto): Boolean {
        val key = normalizeWorktreePath(item.path)
        return input.stats[key]?.unavailable == true || input.dirty[key]?.unavailable == true
    }

    private fun ghLine(value: GhAvailability): String = when (value) {
        GhAvailability.OK -> "ok"
        GhAvailability.MISSING -> "NOT FOUND"
        GhAvailability.UNAUTH -> "not authorized"
        GhAvailability.RATE_LIMITED -> "rate limited"
        GhAvailability.TIMEOUT -> "did not answer within its budget"
        GhAvailability.GIT_MISSING -> "not probed (git missing)"
    }
}
