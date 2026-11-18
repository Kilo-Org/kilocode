package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/**
 * Project-local presentation cache for Cloud workspace PRs.
 *
 * Cloud is authoritative; this cache never persists. It is keyed per workspace so sibling session
 * selection, row rebuilds, and catalog refreshes keep the badge, and it is dropped when the signed-in
 * account/org changes or the user signs out. Only the explicit `no_pr` state clears a badge; a
 * transport failure or rate limit keeps the last known one.
 */
@Service(Service.Level.PROJECT)
class HostedPullRequestService internal constructor(
    private val cs: CoroutineScope,
    private val read: suspend (HostedWorkspaceRefDto) -> HostedWorkspacePullRequestDto,
    private val revalidate: suspend (HostedWorkspaceRefDto) -> HostedWorkspacePullRequestDto,
    private val pause: suspend (Long) -> Unit,
    private val clock: () -> Long,
    private val identity: StateFlow<String?>?,
    private val signedOut: StateFlow<Boolean>?,
) {
    constructor(project: Project, cs: CoroutineScope) : this(
        cs,
        { project.service<KiloHostedService>().pullRequest(it) },
        { project.service<KiloHostedService>().refreshPullRequest(it) },
        { delay(it) },
        System::currentTimeMillis,
        project.service<KiloAppService>().state
            .map { state -> "${state.profile?.email}\u0000${state.profile?.currentOrgId}" }
            .stateIn(cs, SharingStarted.Eagerly, null),
        project.service<KiloHostedService>().state
            .map { state -> !state.enabled || state.signedOut }
            .stateIn(cs, SharingStarted.Eagerly, false),
    )

    init {
        observe()
    }

    private data class Entry(
        val result: HostedWorkspacePullRequestDto,
        val pull: WorktreePrDto?,
        val head: String?,
    )

    private val _pulls = MutableStateFlow<Map<String, WorktreePrDto>>(emptyMap())
    val pulls: StateFlow<Map<String, WorktreePrDto>> = _pulls.asStateFlow()

    private val entries = ConcurrentHashMap<String, Entry>()
    private val generations = ConcurrentHashMap<String, Long>()
    private val requests = ConcurrentHashMap<String, Job>()
    private val polls = ConcurrentHashMap<String, Job>()
    private val attempts = ConcurrentHashMap<String, Int>()
    private val reads = ConcurrentHashMap<String, Long>()

    /**
     * Refreshes one workspace. [revalidate] asks the core to re-read GitHub now (turn end, user
     * refresh, poll); otherwise the passive read may return cached evidence.
     */
    fun refresh(ref: HostedWorkspaceRefDto, revalidate: Boolean = false) {
        if (this.signedOut?.value == true) return
        val key = ref.key
        if (requests[key]?.isActive == true) return
        if (!revalidate && clock() - (reads[key] ?: 0) < READ_THROTTLE) return
        if (revalidate) {
            val retry = retryAt(entries[key]?.result)
            if (retry != null && retry > clock()) return
        }
        reads[key] = clock()
        val generation = generations.merge(key, 1L) { current, _ -> current + 1 } ?: 1L
        val job = cs.launch {
            val result = try {
                if (revalidate) this@HostedPullRequestService.revalidate(ref) else read(ref)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                HostedWorkspacePullRequestDto(ref, "unreachable", null)
            }
            if (result.ref != ref) return@launch
            if ((generations[key] ?: 0L) != generation) return@launch
            apply(ref, result)
        }
        requests[key] = job
        job.invokeOnCompletion {
            if (requests[key] === job) requests.remove(key)
        }
    }

    fun refreshAll(refs: Collection<HostedWorkspaceRefDto>, revalidate: Boolean = false) {
        refs.forEach { refresh(it, revalidate) }
    }

    fun clear() {
        entries.clear()
        generations.clear()
        attempts.clear()
        reads.clear()
        requests.values.forEach { it.cancel() }
        requests.clear()
        polls.values.forEach { it.cancel() }
        polls.clear()
        _pulls.value = emptyMap()
    }

    private fun apply(ref: HostedWorkspaceRefDto, result: HostedWorkspacePullRequestDto) {
        val key = ref.key
        val previous = entries[key]
        val head = result.pullRequest?.headSha
        val pull = present(result, previous)
        val pending = previous?.pull?.let(::hostedPullRequestPending) == true
        entries[key] = Entry(result, pull, head)
        _pulls.update { current ->
            if (pull == null) current - key else current + (key to pull)
        }
        if (hostedPullRequestPending(pull)) {
            if (!pending) attempts.remove(key)
            schedule(ref)
        } else {
            attempts.remove(key)
            polls.remove(key)?.cancel()
        }
    }

    private fun present(result: HostedWorkspacePullRequestDto, previous: Entry?): WorktreePrDto? {
        if (result.state == "no_pr") return null
        val summary = result.pullRequest ?: return previous?.pull
        val mapped = hostedPullRequest(summary, result.ref)
        if (mapped != null) return mapped
        // A partial observation can carry an unknown PR state or an unusable identity. Keep the last
        // badge only when it is provably the same PR and head; never inherit across a new head.
        val previousPull = previous?.pull ?: return null
        val same = previousPull.number.toLong() == summary.number && previousPull.url == summary.url.trim()
        val fresh = previous.head == null || summary.headSha == null || previous.head == summary.headSha
        return if (same && fresh) previousPull else null
    }

    private fun schedule(ref: HostedWorkspaceRefDto) {
        val key = ref.key
        if (polls[key]?.isActive == true) return
        val job = cs.launch {
            // One job owns the whole pending streak. It also waits out a core retry deadline rather
            // than firing just before it and losing the loop, and stops at the attempt cap.
            while (true) {
                if (signedOut?.value == true) return@launch
                val entry = entries[key] ?: return@launch
                if (!hostedPullRequestPending(entry.pull)) return@launch
                if ((attempts[key] ?: 0) >= POLL_LIMIT) return@launch
                val retry = retryAt(entry.result)
                val wait = if (retry != null && retry > clock()) {
                    (retry - clock() + RETRY_MARGIN).coerceIn(MIN_POLL_MS, MAX_WAIT_MS)
                } else {
                    POLL_MS
                }
                pause(wait)
                if (signedOut?.value == true) return@launch
                if (entries[key]?.pull?.let(::hostedPullRequestPending) != true) return@launch
                attempts[key] = (attempts[key] ?: 0) + 1
                refresh(ref, revalidate = true)
                requests[key]?.join()
            }
        }
        polls[key] = job
        job.invokeOnCompletion {
            if (polls[key] === job) polls.remove(key)
        }
    }

    private fun observe() {
        identity?.let { flow ->
            cs.launch {
                var previous: String? = null
                flow.collect { value ->
                    if (previous != null && previous != value) clear()
                    previous = value
                }
            }
        }
        signedOut?.let { flow ->
            cs.launch {
                flow.collect { gone -> if (gone) clear() }
            }
        }
    }

    private fun retryAt(result: HostedWorkspacePullRequestDto?): Long? =
        result?.refresh?.retryAt?.let { value ->
            runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
        }

    private companion object {
        const val READ_THROTTLE = 15_000L
        const val POLL_MS = 60_000L
        const val MIN_POLL_MS = 1_000L
        const val MAX_WAIT_MS = 300_000L
        const val POLL_LIMIT = 10
        const val RETRY_MARGIN = 2_000L
    }
}
