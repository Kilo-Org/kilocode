package ai.kilocode.backend.cli

import ai.kilocode.log.KiloLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import okhttp3.Call
import okhttp3.Response

private val log = KiloLog.create(Call::class.java)

/**
 * Runs a blocking OkHttp [Call] as a cancellable suspend function.
 *
 * The call executes on [Dispatchers.IO]; when the surrounding coroutine is cancelled —
 * by a `withTimeout` deadline or by plugin-unload scope cancellation — [Call.cancel] is
 * invoked so the blocked socket read aborts and the IO thread is released promptly.
 *
 * This deliberately avoids OkHttp's own `callTimeout` (which starts Okio's unkillable
 * "Okio Watchdog" daemon thread and pins the plugin classloader). Enforce a total
 * per-call deadline by wrapping the call site: `withTimeout(ms) { call.await().use { … } }`.
 */
suspend fun Call.await(): Response = coroutineScope {
    val call = this@await
    val job = async(Dispatchers.IO) { call.execute() }
    try {
        job.await()
    } catch (e: CancellationException) {
        // Abort the socket so the uninterruptible execute() unblocks and the child completes.
        // Logged so a plugin-unload/timeout cancellation visibly aborts the in-flight socket read.
        log.debug { "await: cancelled — aborting in-flight call ${call.request().url}" }
        runCatching { call.cancel() }
        throw e
    }
}
