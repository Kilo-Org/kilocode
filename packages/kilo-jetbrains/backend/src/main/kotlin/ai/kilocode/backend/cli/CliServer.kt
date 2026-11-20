package ai.kilocode.backend.cli

import ai.kilocode.backend.v2.V2Client
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import okhttp3.Credentials
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.Proxy
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Owns the stdio lease. Only the backend sees its address and credential. */
internal class CliServer private constructor(
    private val process: Process,
    private val password: String,
    private val expectedVersion: String?,
) {
    companion object {
        private val random = SecureRandom()
        private val probe = OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .callTimeout(2, TimeUnit.SECONDS).build()

        fun start(command: CliCommand, cwd: Path, env: Map<String, String>): CliServer {
            val password = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(random::nextBytes))
            val process = ProcessBuilder(command.argv + listOf("serve", "--port", "0", "--stdio"))
                .directory(Files.createDirectories(cwd).toFile()).apply {
                    environment().clear()
                    environment().putAll(env + command.env + ("OPENCODE_PASSWORD" to password))
                }.start()
            return CliServer(process, password, command.expectedVersion)
        }
    }

    private val authorization = Credentials.basic("opencode", password)
    private val candidates = Channel<String>(16, BufferOverflow.DROP_OLDEST)
    private val stderr = StringBuilder()
    private var stopping: CompletableFuture<Void>? = null
    @Volatile private var started = false
    val alive: Boolean get() = process.isAlive

    init {
        Thread.ofVirtual().name("kilo2-stdout").start {
            try {
                process.inputStream.bufferedReader().use { reader ->
                    // Ignore oversized/non-JSON lines; keep draining both pipes after readiness.
                    val line = StringBuilder()
                    val buffer = CharArray(2048)
                    while (true) {
                        val count = reader.read(buffer)
                        if (count < 0) break
                        if (started) continue
                        for (i in 0 until count) {
                            if (buffer[i] != '\n') {
                                if (line.length <= 4096) line.append(buffer[i])
                                continue
                            }
                            if (line.length <= 4096) candidate(line.toString().trim())?.let(candidates::trySend)
                            line.clear()
                        }
                    }
                }
            } catch (_: IOException) { /* shutdown closes the pipe */ }
            finally { candidates.close() }
        }
        Thread.ofVirtual().name("kilo2-stderr").start {
            try {
                process.errorStream.bufferedReader().use { reader ->
                    val buffer = CharArray(1024)
                    while (true) {
                        val count = reader.read(buffer)
                        if (count < 0) break
                        if (!started) synchronized(stderr) {
                            stderr.append(buffer, 0, count)
                            if (stderr.length > 4096) stderr.delete(0, stderr.length - 4096)
                        }
                    }
                }
            } catch (_: IOException) { /* shutdown closes the pipe */ }
        }
    }

    suspend fun identify(timeoutMs: Long): V2Client {
        try {
            return withTimeout(timeoutMs) {
                for (candidate in candidates) {
                    repeat(2) { attempt ->
                        if (attempt != 0) delay(250)
                        if (verified(candidate) && process.isAlive) {
                            started = true
                            return@withTimeout V2Client(candidate, authorization)
                        }
                    }
                }
                error(diagnostic("Kilo v2 closed stdout before reporting an authenticated server"))
            }
        } catch (e: TimeoutCancellationException) {
            error(diagnostic("Kilo v2 did not report an authenticated server within ${timeoutMs}ms"))
        }
    }

    private fun verified(url: String): Boolean {
        fun request(auth: String) = probe.newCall(Request.Builder().url("$url/api/info")
            .header("Authorization", auth).build()).execute()
        return try {
            // Never send the credential to an unrelated service just because a plugin logged a URL.
            val refuses = request(Credentials.basic("opencode", "not-the-password")).use {
                it.code == 401 && jsonType(it.body.contentType()?.subtype)
            }
            if (!refuses) return false
            request(authorization).use {
                if (it.code != 200 || !jsonType(it.body.contentType()?.subtype)) return false
                val info = parseObject(it.peekBody(16 * 1024L).string()) ?: return false
                val pid = (info["pid"] as? JsonPrimitive)?.longOrNull ?: return false
                val version = (info["version"] as? JsonPrimitive)?.contentOrNull ?: return false
                // In dev the isolated wrapper owns the child that actually binds the socket.
                (expectedVersion == null || version == expectedVersion) &&
                    (process.pid() == pid || process.descendants().use { kids -> kids.anyMatch { child -> child.pid() == pid } })
            }
        } catch (_: IOException) { false }
    }

    private fun diagnostic(message: String): String {
        val text = synchronized(stderr) { stderr.toString() }.replace(password, "[redacted]")
            .replace(authorization.removePrefix("Basic "), "[redacted]").trim()
        return if (text.isEmpty()) message else "$message\n$text"
    }

    fun onExit(action: (Int) -> Unit) { process.onExit().thenAccept { action(it.exitValue()) } }

    /** EOF is the normal shutdown protocol. Bound fallback waits off the EDT, including during IDE disposal. */
    @Synchronized fun stop(fast: Boolean = false): CompletableFuture<Void> {
        stopping?.let { return it }
        val done = CompletableFuture<Void>()
        stopping = done
        val children = process.descendants().use { it.toList().asReversed() }
        runCatching { process.outputStream.close() }
        Thread.ofVirtual().name("kilo2-stop").start {
            try {
                if (!process.waitFor(if (fast) 250L else 2_000L, TimeUnit.MILLISECONDS)) {
                    val descendants = (children + process.descendants().use { it.toList().asReversed() }).distinctBy { it.pid() }
                    descendants.forEach { it.destroy() }
                    process.destroy()
                    process.waitFor(1, TimeUnit.SECONDS)
                    descendants.filter { it.isAlive }.forEach { it.destroyForcibly() }
                    if (process.isAlive) process.destroyForcibly()
                    check(process.waitFor(5, TimeUnit.SECONDS)) { "Kilo CLI process did not exit" }
                }
                done.complete(null)
            } catch (e: Exception) { done.completeExceptionally(e) }
        }
        return done
    }
}

private fun jsonType(subtype: String?) = subtype == "json" || subtype?.endsWith("+json") == true

private fun parseObject(line: String): JsonObject? = try {
    Json.parseToJsonElement(line) as? JsonObject
} catch (_: IllegalArgumentException) { null }

private fun candidate(line: String): String? {
    if (!line.startsWith('{')) return null
    val raw = (parseObject(line)?.get("url") as? JsonPrimitive)?.contentOrNull ?: return null
    val url = try { URI(raw) } catch (_: java.net.URISyntaxException) { return null }
    if (url.scheme != "http" || url.host !in setOf("127.0.0.1", "[::1]") || url.port !in 1..65535 ||
        url.rawUserInfo != null || url.rawQuery != null || url.rawFragment != null || url.rawPath !in setOf("", "/")) return null
    return "http://${url.host}:${url.port}"
}
