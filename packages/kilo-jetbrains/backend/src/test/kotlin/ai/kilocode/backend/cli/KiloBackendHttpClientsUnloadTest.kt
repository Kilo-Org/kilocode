package ai.kilocode.backend.cli

import com.sun.net.httpserver.HttpServer
import okhttp3.Protocol
import okhttp3.Request
import java.net.InetSocketAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Guards the plugin-classloader unload safety of the bundled OkHttp/Okio stack.
 *
 * The classloader-pinning failure we fixed came from daemon threads OkHttp/Okio spawn:
 * Okio's "Okio Watchdog" (started by any `callTimeout` or HTTP/2 stream timeout) and OkHttp's
 * shared "OkHttp TaskRunner". These tests assert (1) our HTTP/1.1 + no-`callTimeout` clients
 * never start the Okio watchdog, and (2) the reflection used to shut down the shared task
 * runner on unload still resolves against the bundled OkHttp version.
 */
class KiloBackendHttpClientsUnloadTest {

    private fun threadNames() = Thread.getAllStackTraces().keys.map { it.name }

    private fun startServer(): HttpServer {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            val body = "ok".toByteArray()
            ex.sendResponseHeaders(200, body.size.toLong())
            ex.responseBody.use { it.write(body) }
        }
        server.start()
        return server
    }

    @Test
    fun `http1 clients never start the okio watchdog`() {
        val server = startServer()
        val base = "http://127.0.0.1:${server.address.port}/"
        // Delta check: assert our own traffic does not create the (process-wide, shared) watchdog,
        // independent of whatever another test in this JVM may already have started.
        val watchdogBefore = threadNames().any { it == "Okio Watchdog" }

        val fetch = KiloBackendHttpClients.modelFetch()
        val health = KiloBackendHttpClients.health("pw")
        try {
            repeat(3) {
                fetch.newCall(Request.Builder().url(base).build()).execute().use { assertEquals(200, it.code) }
                health.newCall(Request.Builder().url(base).build()).execute().use { assertEquals(200, it.code) }
            }
            val watchdogAfter = threadNames().any { it == "Okio Watchdog" }
            assertEquals(
                watchdogBefore,
                watchdogAfter,
                "HTTP/1.1 requests without callTimeout must not start Okio's watchdog thread",
            )
        } finally {
            KiloBackendHttpClients.shutdown(fetch)
            KiloBackendHttpClients.shutdown(health)
            server.stop(0)
        }
    }

    @Test
    fun `all clients are pinned to http1 only`() {
        val clients = listOf(
            KiloBackendHttpClients.api("x"),
            KiloBackendHttpClients.appLoad("x", 5_000),
            KiloBackendHttpClients.health("x"),
            KiloBackendHttpClients.cliDownload(),
            KiloBackendHttpClients.modelFetch(),
        )
        try {
            clients.forEach { assertEquals(listOf(Protocol.HTTP_1_1), it.protocols) }
        } finally {
            clients.forEach { KiloBackendHttpClients.shutdown(it) }
        }
    }

    @Test
    fun `all clients disable every AsyncTimeout-backed timeout`() {
        // call/read/write timeouts are the three AsyncTimeout sources; any positive value starts the
        // Okio watchdog (write defaults to 10s in OkHttp, so it must be zeroed explicitly). Only the
        // connect timeout — JDK socket connect, no AsyncTimeout — may be positive.
        val clients = listOf(
            KiloBackendHttpClients.api("x"),
            KiloBackendHttpClients.appLoad("x", 5_000),
            KiloBackendHttpClients.health("x"),
            KiloBackendHttpClients.cliDownload(),
            KiloBackendHttpClients.modelFetch(),
        )
        try {
            clients.forEach {
                assertEquals(0, it.callTimeoutMillis, "callTimeout must be 0")
                assertEquals(0, it.readTimeoutMillis, "readTimeout must be 0")
                assertEquals(0, it.writeTimeoutMillis, "writeTimeout must be 0")
                assertTrue(it.connectTimeoutMillis > 0, "connectTimeout should bound connection setup")
            }
        } finally {
            clients.forEach { KiloBackendHttpClients.shutdown(it) }
        }
    }

    @Test
    fun `shutdown terminates a client dispatcher executor`() {
        val client = KiloBackendHttpClients.api("x")
        // Touch the executor so it exists, then ensure shutdown() terminates it.
        client.dispatcher.executorService
        KiloBackendHttpClients.shutdown(client)
        assertTrue(client.dispatcher.executorService.isShutdown)
    }

    @Test
    fun `shared task runner executor is reachable via reflection`() {
        // Guards the internal-API reflection used by shutdownAll() on plugin unload. If a future
        // OkHttp bump renames TaskRunner.INSTANCE / backend / executor, this fails loudly instead
        // of silently leaving the daemon threads (and the classloader) alive. Resolve only — do
        // not shut it down here, as it is shared across the test JVM.
        assertNotNull(KiloBackendHttpClients.sharedTaskRunnerExecutor())
    }
}
