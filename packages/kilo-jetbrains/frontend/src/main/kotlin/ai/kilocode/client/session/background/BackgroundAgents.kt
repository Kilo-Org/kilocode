package ai.kilocode.client.session.background

import ai.kilocode.rpc.dto.BackgroundJobDto

/**
 * Pure derivation for the background-agents strip. Platform-free and RPC-free by design — the
 * strip's Swing view must never touch these lists except through [ai.kilocode.client.session.model.SessionModel].
 *
 * Mirrors `packages/kilo-vscode/webview-ui/src/components/chat/background-agents.ts`.
 */
object BackgroundAgents {

    /**
     * Background subagent rows owned by root session [parent].
     *
     * The CLI's list route already filters by `parentSessionId == parent`; the check is repeated
     * here defensively, matching the VS Code webview. Only jobs with `type == "task"` and
     * `metadata.background == true` count — a foreground task in progress is not a background
     * agent yet. [waiting] is the set of child session ids with a pending permission request; a
     * child session id with no matching job is ignored.
     */
    fun rows(jobs: List<BackgroundJobDto>, parent: String, waiting: Set<String> = emptySet()): List<BackgroundAgent> =
        jobs
            .filter { it.type == "task" && it.parentSessionId == parent && it.background }
            .map { job ->
                val session = job.sessionId ?: job.id
                BackgroundAgent(
                    job = job.id,
                    session = session,
                    title = job.title,
                    status = status(job.status),
                    error = job.error,
                    waiting = session in waiting,
                )
            }

    /**
     * A running agent always shows; a finished one only shows until dismissed. A dismissed job that
     * starts running again (e.g. after a resume) reappears, because dismissal is not durable state.
     */
    fun visible(agent: BackgroundAgent, dismissed: Set<String>): Boolean =
        agent.status == BackgroundAgentStatus.RUNNING || agent.job !in dismissed

    /** Active agents (running, or finished but awaiting input) first, stable order within each group. */
    fun order(agents: List<BackgroundAgent>): List<BackgroundAgent> {
        val (active, rest) = agents.partition { it.status == BackgroundAgentStatus.RUNNING || it.waiting }
        return active + rest
    }

    private fun status(raw: String): BackgroundAgentStatus = when (raw) {
        "running" -> BackgroundAgentStatus.RUNNING
        "cancelled" -> BackgroundAgentStatus.CANCELLED
        "error" -> BackgroundAgentStatus.ERROR
        else -> BackgroundAgentStatus.COMPLETED
    }
}
