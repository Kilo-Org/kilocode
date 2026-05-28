package ai.kilocode.backend.cli

import okhttp3.ConnectionPool
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import java.util.Base64
import java.util.concurrent.TimeUnit

/**
 * Factory for the OkHttp clients used by the plugin.
 *
 * Mirrors the VS Code architecture:
 * - [api] client has no call/read timeout (streaming ops like prompt/SSE can run long)
 * - [appLoad] client has a bounded timeout for startup REST calls
 * - [health] client has a short 3 s timeout and a small dedicated connection pool
 *
 * Both clients bundle Basic Auth via an interceptor and are fully independent
 * of any IntelliJ-platform-provided HTTP stack.
 */
object KiloBackendHttpClients {

    private const val CONNECT_TIMEOUT_MS = 10_000L
    private const val HEALTH_TIMEOUT_MS = 3_000L

    /** API client — no call/read timeout (SSE and long-running ops). */
    fun api(password: String): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(auth(password))
            .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()

    /** App-load client — bounded timeout for required startup REST calls. */
    fun appLoad(password: String, timeoutMs: Long): OkHttpClient {
        val timeout = timeoutMs.coerceAtLeast(1L)
        return OkHttpClient.Builder()
            .addInterceptor(auth(password))
            .connectTimeout(CONNECT_TIMEOUT_MS.coerceAtMost(timeout), TimeUnit.MILLISECONDS)
            .callTimeout(timeout, TimeUnit.MILLISECONDS)
            .readTimeout(timeout, TimeUnit.MILLISECONDS)
            .connectionPool(ConnectionPool(2, 30, TimeUnit.SECONDS))
            .build()
    }

    /** Health client — short timeout, dedicated connection pool. */
    fun health(password: String): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(auth(password))
            .connectTimeout(HEALTH_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .callTimeout(HEALTH_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .connectionPool(ConnectionPool(1, 30, TimeUnit.SECONDS))
            .build()

    /** Shut down both dispatcher and connection pool for the given client. */
    fun shutdown(client: OkHttpClient) {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    private fun auth(password: String): Interceptor {
        val header = "Basic ${Base64.getEncoder().encodeToString("kilo:$password".toByteArray())}"
        return Interceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("Authorization", header)
                    .build()
            )
        }
    }
}
