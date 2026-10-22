package ai.kilocode.backend.cli

import com.intellij.openapi.application.ApplicationManager
import com.intellij.util.net.JdkProxyProvider
import com.intellij.util.net.ssl.CertificateManager
import okhttp3.ConnectionPool
import okhttp3.Credentials
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.Base64
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

    /** CLI download client — platform TLS/proxy settings for GitHub release traffic. */
    fun cliDownload(): OkHttpClient = externalBuilder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    /** Model fetch client — platform TLS/proxy settings for user-supplied provider URLs. */
    fun modelFetch(): OkHttpClient = externalBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Derive a per-request bounded client from an existing one, preserving auth/interceptors. */
    fun bounded(client: OkHttpClient, timeoutSeconds: Long): OkHttpClient {
        val timeout = timeoutSeconds.coerceAtLeast(1L)
        return client.newBuilder()
            .callTimeout(timeout, TimeUnit.SECONDS)
            .readTimeout(timeout, TimeUnit.SECONDS)
            .build()
    }

    /**
     * Builder for outbound internet requests wired to the IDE certificate store and proxy.
     *
     * When no IntelliJ application is available (unit tests, early bootstrap) the platform
     * services cannot be resolved, so a bare builder is returned unchanged.
     */
    fun externalBuilder(): OkHttpClient.Builder {
        val builder = OkHttpClient.Builder()
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
