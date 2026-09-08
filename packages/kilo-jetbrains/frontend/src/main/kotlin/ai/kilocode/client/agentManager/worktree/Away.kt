package ai.kilocode.client.agentManager.worktree

/**
 * How long the IDE spent out of focus, so a return can be answered in proportion to the absence
 * rather than by a flat throttle.
 *
 * Both gh availability and pull-request state are things the user changes elsewhere — `gh auth login`
 * in a terminal, a PR merged in a browser — so the chance that a cached answer went stale scales with
 * the time away. A 400ms flicker cannot have contained any of that; a five-minute absence very likely
 * did.
 *
 * Driven by `ApplicationActivationListener.applicationDeactivated`, which the platform already limits
 * to focus leaving the application entirely (it fires only for a `WINDOW_DEACTIVATED` with no opposite
 * window, so a popup or dialog that keeps focus inside the IDE never reaches it). The platform's own
 * `delayedApplicationDeactivated` additionally waits out `application.deactivation.timeout` before
 * confirming, because a heavyweight transient window can still produce that event; [REAL] applies the
 * same predicate at return time instead, which needs no `Window` and no proactive timer.
 */
internal class Away(private val now: () -> Long) {
    private var at: Long? = null

    /** Records that focus left the application. */
    fun left() {
        at = now()
    }

    /**
     * Consumes the pending absence and reports its length in milliseconds, or null when there was no
     * absence worth acting on — the case a caller should answer by doing nothing at all.
     */
    fun back(): Long? {
        val start = at ?: return null
        at = null
        return (now() - start).takeIf { it >= REAL }
    }

    companion object {
        /**
         * Below this an absence is indistinguishable from a transient window that never meant to take
         * focus out of the IDE, so returning from one is not evidence of anything. Mirrors the
         * platform's `application.deactivation.timeout` default, the delay it waits before confirming
         * a deactivation for the same reason.
         */
        const val REAL = 1_500L

        /**
         * Absences at or past this point stop being explainable as window churn, so the caches
         * covering them are no longer evidence about the current state.
         *
         * The default bar, for a return that costs a single command. A caller whose return costs more
         * than that should raise it — see [ceiling].
         */
        const val FRESH = 10_000L

        /**
         * The freshness ceiling a return from an absence of [gone] justifies: the absence itself once
         * it is long enough to have contained an external change, and null below that to accept
         * whatever the caches already hold.
         *
         * Passing the absence rather than zero is deliberate. Work done *during* the absence — a poll
         * that ran while the window sat in the background, another panel's lookup — is still current
         * and worth reusing; only answers that predate the departure have to be rejected.
         *
         * [bar] is how long an absence has to be to earn one, and belongs to the caller so an expensive
         * return can demand a longer absence before it is worth answering. It is not the caller's
         * spending control: how *often* a return may be paid for is a separate limit, kept by the caller
         * against its own last lookup. Conflating the two makes the bar do both jobs badly — raising it
         * to throttle cost also blinds the caller to the short absences it could have afforded.
         */
        fun ceiling(gone: Long, bar: Long = FRESH): Long? = gone.takeIf { it >= bar }
    }
}
