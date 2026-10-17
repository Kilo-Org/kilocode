package ai.kilocode.backend.repo

import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.util.concurrent.ConcurrentHashMap

/**
 * Fairness gate for git/gh subprocesses spread across repositories.
 *
 * A single service-wide semaphore (the previous design) let one slow or worktree-heavy repository
 * occupy every slot, so every other repo's stats, dirty, and PR polls queued behind it. This gives each
 * repository its own [perRepo] budget under a shared global [global] ceiling.
 *
 * **Acquisition order is per-repo first, then global.** The reverse — global first — would let one
 * repository's burst consume every global permit while its tasks wait on that repo's own gate, starving
 * the other repositories: exactly the failure this type exists to prevent. Here a repository can only
 * ever hold [perRepo] tasks that then contend for the ceiling, so a noisy repo is bounded before it can
 * touch the shared budget.
 *
 * The ceiling still exists: N repositories must not each admit [perRepo] processes at once, which is the
 * process storm the original single budget was introduced to stop (see `parallel`'s comment).
 */
internal class RepoGate(
    private val perRepo: Int,
    private val global: Int,
) {
    private val ceiling = Semaphore(global)
    private val gates = ConcurrentHashMap<String, Semaphore>()

    /** Number of tracked repositories. For tests and diagnostics. */
    internal val size: Int get() = gates.size

    suspend fun <T> withRepo(root: String, block: suspend () -> T): T {
        val gate = gates.computeIfAbsent(root) { Semaphore(perRepo) }
        return gate.withPermit { ceiling.withPermit { block() } }
    }

    /**
     * Drop gates for roots that no longer exist, once the map has grown past [limit], so the map cannot
     * grow without bound as worktrees and repositories churn. A dropped gate that a concurrent caller
     * still holds is harmless: the budget is advisory, and the next call for that root makes a fresh one.
     */
    fun evict(limit: Int, exists: (String) -> Boolean) {
        if (gates.size <= limit) return
        gates.keys.filterNot(exists).forEach { gates.remove(it) }
    }
}
