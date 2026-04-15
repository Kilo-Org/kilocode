package ai.kilocode.backend.testing

import java.io.BufferedWriter
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lightweight mock HTTP server simulating the Kilo CLI server.
 *
 * Handles REST endpoints with configurable JSON responses and provides
 * full control over the SSE `/global/event` stream. Uses raw sockets
 * so SSE connections can be held open and events pushed on demand.
 *
 * Supports restart: [start] can be called after [shutdown] to bind a new port.
 * Call [close] for final cleanup (shuts down the thread pool).
 */
class MockCliServer : AutoCloseable {

    val password = "test-password"

    // Configurable REST responses — can be changed between requests
    @Volatile var health = """{"healthy":true,"version":"1.0.0"}"""
    @Volatile var config = """{"model":"test/model"}"""
    @Volatile var notifications = "[]"
    @Volatile var profile = """{"profile":{"email":"test@test.com","name":"Test"},"balance":null,"currentOrgId":null}"""
    @Volatile var profileStatus = 200
    @Volatile var configStatus = 200
    @Volatile var notificationsStatus = 200

    private val executor = Executors.newCachedThreadPool { r ->
        Thread(r, "mock-cli-${Thread.currentThread().id}").apply { isDaemon = true }
    }
    private val closed = AtomicBoolean(false)

    private var server: ServerSocket? = null
    private val connections = ConcurrentLinkedQueue<Socket>()
    private var port = 0

    // SSE stream control — reset on each start()
    @Volatile private var sseWriter: BufferedWriter? = null
    private var sseLatch = CountDownLatch(1)
    private var sseConnected = CountDownLatch(1)

    /** Start (or restart) the mock server. Returns the port. */
    fun start(): Int {
        // Clean up any previous instance
        shutdownServer()

        sseLatch = CountDownLatch(1)
        sseConnected = CountDownLatch(1)
        sseWriter = null

        val srv = ServerSocket(0)
        server = srv
        port = srv.localPort
        executor.submit { acceptLoop(srv) }
        return port
    }

    /** Stop the server socket and SSE without killing the thread pool. */
    fun shutdown() {
        shutdownServer()
    }

    /** Wait until an SSE client has connected (up to [timeout] ms). */
    fun awaitSseConnection(timeout: Long = 5_000): Boolean =
        sseConnected.await(timeout, TimeUnit.MILLISECONDS)

    /** Push an SSE event to the connected client. */
    fun pushEvent(type: String, data: String) {
        val w = sseWriter ?: return
        synchronized(w) {
            w.write("event: $type\n")
            w.write("data: $data\n")
            w.write("\n")
            w.flush()
        }
    }

    /** Close the SSE stream to simulate a server-side disconnect. */
    fun closeSse() {
        val w = sseWriter
        sseWriter = null
        runCatching { w?.close() }
        sseLatch.countDown()
    }

    /** Final cleanup — shuts down the thread pool. Not restartable after this. */
    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        shutdownServer()
        executor.shutdownNow()
    }

    private fun shutdownServer() {
        sseLatch.countDown()
        val w = sseWriter
        sseWriter = null
        runCatching { w?.close() }
        connections.forEach { runCatching { it.close() } }
        connections.clear()
        runCatching { server?.close() }
        server = null
    }

    private fun acceptLoop(srv: ServerSocket) {
        while (!closed.get() && !srv.isClosed) {
            try {
                val socket = srv.accept()
                connections.add(socket)
                executor.submit { handle(socket) }
            } catch (_: SocketException) {
                break
            }
        }
    }

    private fun handle(socket: Socket) {
        try {
            val input = socket.getInputStream().bufferedReader()
            val line = input.readLine() ?: return
            val parts = line.split(" ")
            if (parts.size < 2) return
            val path = parts[1]

            // Read all headers
            while (true) {
                val header = input.readLine()
                if (header.isNullOrBlank()) break
            }

            val output = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))

            when {
                path == "/global/health" -> respond(output, 200, health)
                path == "/global/config" -> respond(output, configStatus, config)
                path.startsWith("/kilo/notifications") -> respond(output, notificationsStatus, notifications)
                path.startsWith("/kilo/profile") -> {
                    if (profileStatus == 401) {
                        respond(output, 401, """{"message":"Unauthorized"}""")
                    } else {
                        respond(output, profileStatus, profile)
                    }
                }
                path == "/global/event" -> handleSse(output)
                else -> respond(output, 404, """{"error":"Not found"}""")
            }
        } catch (_: SocketException) {
            // Client disconnected
        } catch (_: Exception) {
            // Ignore errors in test mock
        }
    }

    private fun respond(writer: BufferedWriter, status: Int, body: String) {
        val phrase = when (status) {
            200 -> "OK"
            401 -> "Unauthorized"
            404 -> "Not Found"
            500 -> "Internal Server Error"
            else -> "Error"
        }
        val bytes = body.toByteArray(Charsets.UTF_8)
        writer.write("HTTP/1.1 $status $phrase\r\n")
        writer.write("Content-Type: application/json\r\n")
        writer.write("Content-Length: ${bytes.size}\r\n")
        writer.write("Connection: close\r\n")
        writer.write("\r\n")
        writer.write(body)
        writer.flush()
    }

    private fun handleSse(writer: BufferedWriter) {
        writer.write("HTTP/1.1 200 OK\r\n")
        writer.write("Content-Type: text/event-stream\r\n")
        writer.write("Cache-Control: no-cache\r\n")
        writer.write("Connection: keep-alive\r\n")
        writer.write("\r\n")
        writer.flush()
        sseWriter = writer
        sseConnected.countDown()
        // Block until SSE is closed or server shuts down
        sseLatch.await()
    }
}
