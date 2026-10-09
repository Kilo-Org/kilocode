package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import ai.kilocode.rpc.dto.WorktreePrDto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Builds the `agent_manager` `overview` result from data this backend already polls.
 *
 * JetBrains has no Agent Manager *sections* (the VS Code grouping worktrees and local sessions are
 * pinned into) — `sections` is always empty. `filter.sectionIDs` therefore can never match anything;
 * it is accepted and silently ignored rather than rejected, since an empty `sections` list already
 * conveys that no grouping exists. `filter.states` is honored.
 *
 * Every array in the wire protocol is capped (see `protocol.ts`): 100 worktrees, 100 sessions per
 * worktree/local group, 500-char names, 200-char IDs. Clamping happens here, at the edge, because an
 * oversized reply is silently dropped by the CLI's schema decode and the request simply times out —
 * the hardest failure mode in this whole feature to diagnose from the Kotlin side.
 */
internal object AgentManagerOverview {
    private const val MAX_LIST = 100
    private const val MAX_NAME = 500
    private const val MAX_ID = 200

    suspend fun build(
        root: String,
        sessions: KiloBackendSessionManager,
        chat: KiloBackendChatManager,
        worktrees: KiloWorktreeRpcApi,
        sectionIDs: List<String>?,
        states: List<String>?,
    ): JsonObject {
        val list = worktrees.list(root)
        val stats = runCatching { worktrees.stats(root) }.getOrNull()?.items.orEmpty().associateBy { it.path }
        val prs = runCatching { worktrees.prStatus(root) }.getOrNull()?.items.orEmpty().associateBy { it.path }
        val main = list.worktrees.firstOrNull { it.main }
        val extra = list.worktrees.filter { !it.main }

        // The `sections` grouping has no JetBrains equivalent — see the class doc. An unmatchable
        // `sectionIDs` filter is accepted as a no-op rather than rejected, since the empty `sections`
        // array it would have filtered already says "nothing is grouped".
        val local = main?.let { buildLocal(it, sessions, chat, states) }
        val ungrouped = extra.take(MAX_LIST).map { worktree ->
            buildWorktree(worktree, stats[worktree.path], prs[worktree.path], sessions, chat, states)
        }

        return buildJsonObject {
            put("sections", buildJsonArray { })
            put("ungrouped", JsonArray(ungrouped))
            local?.let { put("local", it) }
        }
    }

    private fun buildLocal(
        main: WorktreeDto,
        sessions: KiloBackendSessionManager,
        chat: KiloBackendChatManager,
        states: List<String>?,
    ): JsonObject {
        val list = sessions.list(main.path)
        val rows = sessionRows(list, main.path, chat, states)
        return buildJsonObject {
            if (main.branch.isNotBlank() && main.branch != "(detached)") put("branch", clampName(main.branch))
            put("sessions", JsonArray(rows))
        }
    }

    private fun buildWorktree(
        worktree: WorktreeDto,
        stats: WorktreeStatsDto?,
        pr: WorktreePrDto?,
        sessions: KiloBackendSessionManager,
        chat: KiloBackendChatManager,
        states: List<String>?,
    ): JsonObject {
        val list = sessions.list(worktree.path)
        val rows = sessionRows(list, worktree.path, chat, states)
        return buildJsonObject {
            put("id", clampId(worktree.id))
            put("name", clampName(worktree.name))
            put("branch", clampName(worktree.branch))
            when (rows.size) {
                0 -> Unit
                1 -> put("session", rows.single())
                else -> put("sessions", JsonArray(rows.take(MAX_LIST)))
            }
            if (stats != null && !stats.unavailable) {
                put("git", buildJsonObject {
                    put("additions", stats.additions)
                    put("deletions", stats.deletions)
                    put("ahead", stats.ahead)
                    put("behind", stats.behind)
                })
            }
            if (pr != null) put("pullRequest", buildPullRequest(pr))
        }
    }

    private fun buildPullRequest(pr: WorktreePrDto): JsonObject = buildJsonObject {
        put("number", pr.number)
        put("state", when (pr.state) {
            GhState.OPEN -> "open"
            GhState.DRAFT -> "draft"
            GhState.MERGED -> "merged"
            GhState.CLOSED -> "closed"
        })
        put("checks", when (pr.checks.state) {
            GhChecks.PASSED -> "success"
            GhChecks.FAILED -> "failure"
            GhChecks.PENDING -> "pending"
            GhChecks.NONE -> "none"
        })
        when (pr.review) {
            GhReview.APPROVED -> put("review", "approved")
            GhReview.CHANGES_REQUESTED -> put("review", "changes_requested")
            GhReview.PENDING -> put("review", "pending")
            GhReview.NONE -> Unit
        }
        if (pr.comments.unresolved > 0) put("unresolvedComments", pr.comments.unresolved)
    }

    private fun sessionRows(
        list: SessionListDto,
        directory: String,
        chat: KiloBackendChatManager,
        states: List<String>?,
    ): List<JsonObject> {
        val permissions = runCatching { chat.pendingPermissions(directory) }.getOrDefault(emptyList())
        val questions = runCatching { chat.pendingQuestions(directory) }.getOrDefault(emptyList())
        return list.sessions.mapNotNull { session ->
            val row = sessionRow(session, list.statuses[session.id]?.type, permissions, questions)
            row.takeIf { states == null || wireState(row) in states }
        }.take(MAX_LIST)
    }

    private fun sessionRow(
        session: SessionDto,
        status: String?,
        permissions: List<PermissionRequestDto>,
        questions: List<QuestionRequestDto>,
    ): JsonObject {
        val activityWire = when (status) {
            "busy" -> "busy"
            "retry" -> "retry"
            else -> "idle"
        }
        val attention = buildList {
            if (permissions.any { it.sessionID == session.id }) add("permission")
            if (questions.any { it.sessionID == session.id }) add("question")
        }
        return buildJsonObject {
            put("id", clampId(session.id))
            put("name", clampName(session.title.ifBlank { session.id }))
            put("activity", activityWire)
            if (attention.isNotEmpty()) put("attention", buildJsonArray { attention.forEach { add(JsonPrimitive(it)) } })
        }
    }

    /**
     * Reconstructs the `FilterState` a row would be matched against: the four [Request.Overview]
     * activity values, plus `waiting` when either attention flag is set — mirroring the VS Code
     * bridge's own filter semantics (`orchestration-domain.ts`'s `overview` filtering).
     */
    private fun wireState(row: JsonObject): String {
        val attention = (row["attention"] as? JsonArray)?.isNotEmpty() == true
        if (attention) return "waiting"
        return (row["activity"] as? JsonPrimitive)?.content ?: "idle"
    }

    private fun clampName(value: String) = value.take(MAX_NAME)
    private fun clampId(value: String) = value.take(MAX_ID)
}
