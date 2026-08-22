package ai.kilocode.backend.cli

import ai.kilocode.log.KiloLog
import com.intellij.openapi.application.ApplicationManager
import com.intellij.util.net.JdkProxyProvider
import com.intellij.util.net.ssl.CertificateManager
import okhttp3.ConnectionPool
import okhttp3.Credentials
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import java.net.Authenticator as JdkAuthenticator

/**
 * Factory for the OkHttp clients used by the plugin.
 *
 * Localhost clients ([api], [appLoad], [health]) talk only to the spawned CLI on
 * `127.0.0.1`, bundle Basic Auth via an interceptor, and deliberately stay off the
 * IntelliJ proxy stack so loopback traffic is never routed through a proxy.
 *
 * External clients ([cliDownload], [modelFetch]) reach the public internet (GitHub
 * releases, user-supplied provider URLs) and are wired to the IDE's configured
 * certificate store and proxy via [externalBuilder] so they work on corporate
 * networks that MITM TLS or require an authenticated proxy.
 *
 * ## Dynamic-unload safety
 *
 * OkHttp is bundled inside the plugin classloader, so any daemon thread its classes
 * spawn pins that classloader and blocks IntelliJ dynamic plugin unload. Two rules
 * keep us unload-safe:
 *
 * 1. **Zero every OkHttp timeout except connect, and force HTTP/1.1.** OkHttp's whole-call
 *    (`callTimeout`), HTTP/2 stream, and — critically — its plain socket read/write timeouts
 *    are all implemented with Okio's `AsyncTimeout` (`RealConnection.newCodec()` sets
 *    `source.timeout()`/`sink.timeout()` from the client read/write timeouts, and
 *    `Socket.source()`/`sink()` wrap them in a `SocketAsyncTimeout`). Any positive `callTimeout`,
 *    `readTimeout`, or `writeTimeout` therefore lazily starts a process-wide "Okio Watchdog"
 *    daemon thread that only self-exits after 60s idle and has no shutdown API. So we set
 *    `callTimeout`, `readTimeout`, and `writeTimeout` all to 0 (OkHttp's default write timeout
 *    is 10s, so it must be zeroed explicitly) and force HTTP/1.1. Only `connectTimeout` is kept:
 *    it bounds connection establishment via the JDK socket connect, not `AsyncTimeout`. Total
 *    per-call deadlines are enforced at the coroutine layer instead (see [Call.await] +
 *    `withTimeout`, and [KiloConnectionService]'s app-load/health wrappers).
 * 2. **Shut every client and the shared task runner down on unload** via [shutdownAll],
 *    so OkHttp's dispatcher and connection-pool threads terminate inside IntelliJ's
 *    short unload GC window instead of idling out over 60s.
 */
object KiloBackendHttpClients {

    private val log = KiloLog.create(KiloBackendHttpClients::class.java)

    private const val CONNECT_TIMEOUT_MS = 10_000L
    private const val HEALTH_TIMEOUT_MS = 3_000L

    /** Force HTTP/1.1 so no HTTP/2 stream [okio.AsyncTimeout] (and thus no Okio watchdog) is ever scheduled. */
    private val H1 = listOf(Protocol.HTTP_1_1)

    private val CLI_DOWNLOAD_CONNECT_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(30)
    private val MODEL_FETCH_CONNECT_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(15)

    /** Independent external clients ([modelFetch], [cliDownload]) not owned by [KiloConnectionService], shut down on unload. */
    private val tracked = CopyOnWriteArrayList<OkHttpClient>()

    /**
     * Base builder with every [okio.AsyncTimeout]-backed timeout disabled: `callTimeout`,
     * `readTimeout`, and `writeTimeout` are all 0 (OkHttp's default write timeout is 10s, so
     * zeroing it is not redundant) and HTTP/1.1 is forced. This is the single place that
     * guarantees no client can spawn the Okio watchdog; callers add only `connectTimeout`,
     * auth, and pools. Total per-request deadlines live at the coroutine layer.
     */
    private fun noWatchdog(): OkHttpClient.Builder =
        OkHttpClient.Builder()
            .protocols(H1)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(0, TimeUnit.MILLISECONDS)

    /** API client — no request timeouts (SSE and long-running ops); bounded per call site. */
    fun api(password: String): OkHttpClient =
        noWatchdog()
            .addInterceptor(auth(password))
            .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .build()

    /**
     * App-load client for required startup REST calls. Only [connectTimeout][timeoutMs] is bounded;
     * the total call deadline is enforced by [KiloConnectionService.appLoadCall] via `withTimeout`,
     * since a socket read/write timeout here would start the Okio watchdog.
     */
    fun appLoad(password: String, timeoutMs: Long): OkHttpClient {
        val timeout = timeoutMs.coerceAtLeast(1L)
        return noWatchdog()
            .addInterceptor(auth(password))
            .connectTimeout(CONNECT_TIMEOUT_MS.coerceAtMost(timeout), TimeUnit.MILLISECONDS)
            .connectionPool(ConnectionPool(2, 30, TimeUnit.SECONDS))
            .build()
    }

    /**
     * Health client — short connect timeout, dedicated connection pool. Callers wrap the request
     * in `withTimeout([HEALTH_TIMEOUT_MS])` + [Call.await] for the total bound; no socket read
     * timeout (it would start the Okio watchdog).
     */
    fun health(password: String): OkHttpClient =
        noWatchdog()
            .addInterceptor(auth(password))
            .connectTimeout(HEALTH_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .connectionPool(ConnectionPool(1, 30, TimeUnit.SECONDS))
            .build()

    /**
     * CLI download client — platform TLS/proxy settings for GitHub release traffic. No read/write
     * timeout; [KiloCliDownloader] enforces connect bounds here and stall/cancel handling at the
     * coroutine layer.
     */
    fun cliDownload(): OkHttpClient = track(
        externalBuilder()
            .connectTimeout(CLI_DOWNLOAD_CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .build()
    )

    /**
     * Model fetch client — platform TLS/proxy settings for user-supplied provider URLs. No read/write
     * timeout; callers wrap the request in `withTimeout` + [Call.await] for the total bound.
     */
    fun modelFetch(): OkHttpClient = track(
        externalBuilder()
            .connectTimeout(MODEL_FETCH_CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .build()
    )

    /**
     * Builder for outbound internet requests wired to the IDE certificate store and proxy.
     * Starts from [noWatchdog] so external clients never start the Okio watchdog either.
     *
     * When no IntelliJ application is available (unit tests, early bootstrap) the platform
     * services cannot be resolved, so the bare (HTTP/1.1, no-watchdog) builder is returned unchanged.
     */
    fun externalBuilder(): OkHttpClient.Builder {
        val builder = noWatchdog()
        ApplicationManager.getApplication() ?: return builder
        val cert = CertificateManager.getInstance()
        val proxy = JdkProxyProvider.getInstance()
        return builder
            .sslSocketFactory(cert.sslContext.socketFactory, cert.trustManager)
            .proxySelector(proxy.proxySelector)
            .proxyAuthenticator(proxyAuth(proxy.authenticator))
    }

    /** Shut down both dispatcher and connection pool for the given client. */
    fun shutdown(client: OkHttpClient) {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    /**
     * Unload-time teardown: shut down every tracked external client and OkHttp's shared task
     * runner so its daemon threads exit immediately. Call only from the plugin-unload path —
     * it makes OkHttp unusable for the rest of this classloader's life (a reload gets a fresh
     * classloader with a fresh `TaskRunner.INSTANCE`).
     *
     * Logs a before/after snapshot of the classloader-pinning threads so a real unload shows
     * whether the fixes actually cleared them (in particular that the Okio watchdog was never
     * scheduled and the shared TaskRunner threads are being torn down).
     */
    fun shutdownAll() {
        log.info("okhttp unload teardown: start tracked=${tracked.size} threads[${pinningThreads()}]")
        for (client in tracked) {
            runCatching { shutdown(client) }.onFailure { log.warn("okhttp client shutdown failed", it) }
        }
        tracked.clear()
        shutdownSharedTaskRunner()
        // Threads are daemons interrupted by shutdownNow(); they exit asynchronously. This snapshot
        // proves the watchdog stayed absent and shows the pool/TaskRunner threads already draining.
        log.info("okhttp unload teardown: done threads[${pinningThreads()}]")
    }

    /**
     * Shut down `okhttp3.internal.concurrent.TaskRunner.INSTANCE`'s executor so the shared
     * "OkHttp TaskRunner" daemon threads terminate now instead of idling out over 60s.
     */
    private fun shutdownSharedTaskRunner() {
        runCatching {
            val executor = sharedTaskRunnerExecutor()
            if (executor == null) {
                log.info("okhttp TaskRunner: no shared executor resolved — nothing to shut down")
                return@runCatching
            }
            executor.shutdownNow()
            log.info("okhttp TaskRunner: shared executor shutdownNow() issued (isShutdown=${executor.isShutdown})")
        }.onFailure { log.warn("okhttp TaskRunner shutdown failed", it) }
    }

    /** Thread-name prefixes of the bundled OkHttp/Okio daemons that pin the plugin classloader if they outlive unload. */
    private val PINNING = listOf("OkHttp Dispatcher", "OkHttp TaskRunner", "OkHttp ConnectionPool", "Okio Watchdog")

    /** Compact live-thread census keyed by the pinning prefixes above, for unload-verification logging. */
    private fun pinningThreads(): String {
        val counts = PINNING.associateWith { 0 }.toMutableMap()
        for (thread in Thread.getAllStackTraces().keys) {
            val prefix = PINNING.firstOrNull { thread.name.startsWith(it) } ?: continue
            counts[prefix] = counts.getValue(prefix) + 1
        }
        return counts.entries.joinToString(" ") { "${it.key}=${it.value}" }
    }

    /**
     * Reflectively resolve OkHttp's shared task-runner backend executor. `TaskRunner` and its
     * `RealBackend` are `internal` to OkHttp, so we reflect into our own bundled copy. Visible
     * for tests to guard that the field/method names still match the bundled OkHttp version.
     */
    internal fun sharedTaskRunnerExecutor(): ExecutorService? {
        val cls = Class.forName("okhttp3.internal.concurrent.TaskRunner")
        val instance = cls.getField("INSTANCE").get(null)
        val backend = cls.getMethod("getBackend").invoke(instance)
        val field = backend.javaClass.getDeclaredField("executor").apply { isAccessible = true }
        return field.get(backend) as? ExecutorService
    }

    private fun track(client: OkHttpClient): OkHttpClient {
        tracked.add(client)
        return client
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

    /** Answer proxy 407 challenges using the IDE's proxy credentials, without touching global auth state. */
    private fun proxyAuth(auth: JdkAuthenticator): okhttp3.Authenticator = okhttp3.Authenticator { route, response ->
        if (response.code != 407) return@Authenticator null
        val addr = (route?.proxy ?: Proxy.NO_PROXY).address() as? InetSocketAddress ?: return@Authenticator null
        val url = response.request.url
        response.challenges().firstNotNullOfOrNull { challenge ->
            if (!"Basic".equals(challenge.scheme, ignoreCase = true)) return@firstNotNullOfOrNull null
            val pwd = auth.requestPasswordAuthenticationInstance(
                addr.hostString,
                addr.address,
                addr.port,
                url.scheme,
                challenge.realm,
                challenge.scheme,
                url.toUrl(),
                JdkAuthenticator.RequestorType.PROXY,
            ) ?: return@firstNotNullOfOrNull null
            response.request.newBuilder()
                .header("Proxy-Authorization", Credentials.basic(pwd.userName, String(pwd.password), challenge.charset))
                .build()
        }
    }
}
