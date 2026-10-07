package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.AgentManagerStartProgressDto
import ai.kilocode.rpc.dto.AgentManagerStartStage
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.nio.file.Path
import java.security.SecureRandom

/**
 * Executes `kilocode.agent_manager.start` — worktree/session creation requested by the `agent_manager`
 * tool's `start` action. Fire-and-forget on the CLI side (see [AgentManagerProtocol.Start]'s doc): the
 * tool call already returned before this runs, so failures are reported only through [progress] and
 * logs, never back to the CLI.
 *
 * Scope note: unlike the New Worktree dialog's [ai.kilocode.client.agentManager.worktree.
 * runWorktreeSetupScript], a host-initiated worktree does not open an interactive setup-script
 * terminal — that path is frontend/EDT/`Project`-bound (it opens a real terminal tab) and this runs
 * headless on the backend for a directory that may belong to no open project at all. The worktree is
 * left exactly as `KiloWorktreeRpcApi.create` leaves any other new worktree; a user who opens it can
 * still run its setup script by hand the normal way.
 */
internal class AgentManagerStarter(
    private val sessions: KiloBackendSessionManager,
    private val chat: KiloBackendChatManager,
    private val worktrees: KiloWorktreeRpcApi,
) {
    companion object {
        private val LOG = KiloLog.create(AgentManagerStarter::class.java)
    }

    private val _progress = MutableSharedFlow<AgentManagerStartProgressDto>(extraBufferCapacity = 64)
    val progress: SharedFlow<AgentManagerStartProgressDto> = _progress.asSharedFlow()

    /**
     * [root] is the directory the requesting session reported in the SSE envelope — the admitted
     * workspace root for `mode = "local"`, or the repository root a new worktree is created under for
     * `mode = "worktree"`. [root] is used as-is for `worktreeID`-targeted local sessions too: the tool
     * only allows `worktreeID` with `mode = "local"`, and resolving a worktree ID to its path is the
     * same lookup `KiloWorktreeRpcApi.list` already performs, so it is done once here rather than
     * duplicated.
     */
    suspend fun start(start: AgentManagerProtocol.Start, root: String) {
        val target = resolveTarget(start, root) ?: run {
            start.tasks.forEach { emitFailed(start.requestID, "Unknown worktree ${start.worktreeID}") }
            return
        }
        for (task in start.tasks) {
            runCatching { startOne(start, task, target) }
                .onFailure { err ->
                    LOG.warn("agent_manager start task failed: ${err.message}", err)
                    emitFailed(start.requestID, err.message ?: "Agent Manager session creation failed")
                }
        }
    }

    private suspend fun resolveTarget(start: AgentManagerProtocol.Start, root: String): String? {
        if (start.mode != "local" || start.worktreeID == null) return root
        val match = worktrees.list(root).worktrees.firstOrNull { it.id == start.worktreeID } ?: return null
        return match.path
    }

    private suspend fun startOne(start: AgentManagerProtocol.Start, task: AgentManagerProtocol.StartTask, localTarget: String) {
        _progress.emit(AgentManagerStartProgressDto(start.requestID, AgentManagerStartStage.PREPARING))
        val directory = if (start.mode == "worktree") createWorktree(start, task, localTarget) else localTarget
        val session = sessions.create(directory)
        sessions.setDirectory(session.id, directory)
        if (task.prompt?.isNotBlank() == true) {
            chat.prompt(
                session.id,
                directory,
                PromptDto(
                    parts = listOf(PromptPartDto(type = "text", text = task.prompt)),
                    providerID = task.providerID,
                    modelID = task.modelID,
                    variant = task.variant,
                ),
            )
        }
        _progress.emit(
            AgentManagerStartProgressDto(
                start.requestID,
                AgentManagerStartStage.READY,
                worktreeID = if (start.mode == "worktree") directory else null,
                sessionID = session.id,
            ),
        )
    }

    private suspend fun createWorktree(
        start: AgentManagerProtocol.Start,
        task: AgentManagerProtocol.StartTask,
        root: String,
    ): String {
        val branch = branchName(task)
        val result = worktrees.create(root, CreateWorktreeRequestDto(branch))
        val worktree = result.worktree
            ?: throw IllegalStateException(result.error ?: "Worktree creation failed for branch $branch")
        val title = task.name?.trim().takeUnless { it.isNullOrEmpty() } ?: task.branchName?.trim()
        if (!title.isNullOrEmpty()) runCatching { worktrees.adopt(root, worktree.path, title) }
        AgentManagerWorktreeChanges.emit(Path.of(root).normalize().toString())
        return worktree.path
    }

    private fun emitFailed(requestID: String, error: String) {
        _progress.tryEmit(AgentManagerStartProgressDto(requestID, AgentManagerStartStage.FAILED, error = error))
    }

    /**
     * A git-safe branch name for a new worktree: the task's own [AgentManagerProtocol.StartTask.
     * branchName] when given, else a slug of its display name, else a random suffix so concurrent
     * tasks in one `start` batch never collide.
     */
    private fun branchName(task: AgentManagerProtocol.StartTask): String {
        val seed = task.branchName?.trim()?.takeIf { it.isNotEmpty() }
            ?: task.name?.trim()?.takeIf { it.isNotEmpty() }
            ?: return "agent/${randomSuffix()}"
        val slug = seed.lowercase()
            .map { ch -> if (ch.isLetterOrDigit() || ch == '/' || ch == '-' || ch == '_') ch else '-' }
            .joinToString("")
            .trim('-')
            .ifEmpty { "agent" }
        return "agent/$slug-${randomSuffix()}"
    }

    private fun randomSuffix(): String {
        val bytes = ByteArray(4)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
