package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.app.KiloBackendChatManager
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.nio.file.Path
import java.security.SecureRandom

/**
 * Executes `kilocode.agent_manager.start` — worktree/session creation requested by the `agent_manager`
 * tool's `start` action. Fire-and-forget on the CLI side (see [AgentManagerProtocol.Start]'s doc): the
 * tool call already returned before this runs, so a failure can only be logged, never reported back
 * to the CLI. A task that fails therefore leaves no session; the chat learns about it by asking for an
 * `overview` and not finding one, which is also how it discovers a session it never saw created.
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
    private val log: KiloLog,
) {
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
            log.warn("agent_manager start req=${start.requestID} failed: unknown worktree ${start.worktreeID}")
            return
        }
        warnUnsupported(start)
        // Sequential and individually guarded: one task's failure must not abandon the rest of the
        // batch, since each task is an independent session the chat asked for. Cancellation, by
        // contrast, must stop the batch: `ensureActive` makes that cooperative even though the work
        // inside is mostly blocking HTTP and git with no suspension point of its own, and the
        // `CancellationException` rethrow keeps a cancellation that does surface from being logged
        // and swallowed as if it were a task failure.
        for (task in start.tasks) {
            currentCoroutineContext().ensureActive()
            try {
                startOne(start, task, target)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                log.warn("agent_manager start req=${start.requestID} task failed: ${err.message}", err)
            }
        }
    }

    private suspend fun resolveTarget(start: AgentManagerProtocol.Start, root: String): String? {
        if (start.mode != "local" || start.worktreeID == null) return root
        val match = worktrees.list(root).worktrees.firstOrNull { it.id == start.worktreeID } ?: return null
        return match.path
    }

    private suspend fun startOne(start: AgentManagerProtocol.Start, task: AgentManagerProtocol.StartTask, localTarget: String) {
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
        log.info("agent_manager start req=${start.requestID} mode=${start.mode} session=${session.id} dir=$directory")
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
        if (!title.isNullOrEmpty()) {
            // Best effort: the worktree is already usable without its display name. Cancellation still
            // propagates rather than being absorbed as a naming failure.
            try {
                worktrees.adopt(root, worktree.path, title)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                log.warn("agent_manager start could not name worktree ${worktree.path}: ${err.message}", err)
            }
        }
        AgentManagerWorktreeChanges.emit(Path.of(root).normalize().toString())
        return worktree.path
    }

    /**
     * Surfaces the parts of a `start` request this host does not implement, instead of quietly
     * under-delivering. `versions: true` asks for alternative-version worktrees (VS Code builds `_vN`
     * variants) and `sandboxInheritanceToken` carries the requesting session's sandbox/snapshot
     * inheritance into the new sessions; neither has a JetBrains equivalent yet. `start` is
     * fire-and-forget with no reply channel, so a log line is the only honest signal available —
     * without it the chat would believe it received something it did not.
     */
    private fun warnUnsupported(start: AgentManagerProtocol.Start) {
        if (start.versions == true) {
            log.warn(
                "agent_manager start req=${start.requestID} ignored versions=true: " +
                    "alternative-version worktrees are not supported in JetBrains; creating one plain worktree per task",
            )
        }
        if (start.sandboxInheritanceToken != null) {
            log.warn(
                "agent_manager start req=${start.requestID} ignored sandboxInheritanceToken: " +
                    "sandbox inheritance is not supported in JetBrains; new sessions start without the requester's grants",
            )
        }
    }

    /**
     * The branch for a new worktree.
     *
     * An explicit [AgentManagerProtocol.StartTask.branchName] is used verbatim: the chat asked for
     * that specific branch, so rewriting it would silently discard the request, and a collision with
     * an existing branch is better surfaced as a failed task the chat can retry under another name.
     * A display name is instead slugged under `agent/` with a random suffix, since it is a title
     * rather than a branch request and several tasks in one batch can share one.
     */
    private fun branchName(task: AgentManagerProtocol.StartTask): String {
        task.branchName?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        val name = task.name?.trim()?.takeIf { it.isNotEmpty() } ?: return "agent/${randomSuffix()}"
        val slug = name.lowercase()
            .map { ch -> if (ch.isLetterOrDigit() || ch == '-' || ch == '_') ch else '-' }
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
