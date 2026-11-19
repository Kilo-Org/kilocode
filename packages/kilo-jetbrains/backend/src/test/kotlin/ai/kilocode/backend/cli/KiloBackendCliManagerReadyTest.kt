package ai.kilocode.backend.cli

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

class KiloBackendCliManagerReadyTest {
    @get:Rule val folder = TemporaryFolder()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var runtime: CliRuntime
    @After fun cleanup() {
        if (::runtime.isInitialized) runtime.shutdown(fast = false)
        scope.cancel()
    }

    private fun fixture(mode: String = "ok", decoy: String = "", timeout: Long = 10_000, resolve: (Boolean) -> Unit = {}) {
        val cwd = folder.root.toPath()
        val fixture = StdioFixture::class.java
        val java = Path.of(System.getProperty("java.home"), "bin", "java").toString()
        // The IDE test classloader supplies no ProtectionDomain.codeSource. Give the child its own classpath.
        val classpath = cwd.resolve("fixture")
        val name = fixture.name.replace('.', '/') + ".class"
        val file = classpath.resolve(name)
        Files.createDirectories(file.parent)
        requireNotNull(fixture.getResourceAsStream("/$name")).use { Files.copy(it, file) }
        runtime = CliRuntime(scope, cwd, { cliEnvironment(System.getenv(), cwd, "test", false) }, { _, force, _ ->
            resolve(force)
            CliCommand(listOf(java, "-cp", classpath.toString(), fixture.name, mode, decoy), expectedVersion = "fixture")
        }, timeout)
    }

    @Test fun `concurrent requests share a client and restart closes stdin before reinstall`() = runBlocking {
        val resolutions = CopyOnWriteArrayList<Boolean>()
        fixture { resolutions.add(it) }
        val clients = List(8) { async { runtime.get() } }.awaitAll()
        clients.forEach { assertSame(clients.first(), it) }
        val pid = clients.first().call("server.info").jsonObject.getValue("pid").jsonPrimitive.long
        assertEquals(CliState.Ready, runtime.state.value)
        val next = runtime.get(restart = true, force = true).call("server.info").jsonObject.getValue("pid").jsonPrimitive.long
        assertNotEquals(pid, next)
        assertTrue(Files.exists(folder.root.toPath().resolve("$pid.eof")))
        assertEquals(listOf(false, true), resolutions.toList())
        val handle = ProcessHandle.of(next).get()
        runtime.shutdown(fast = false)
        assertTrue(!handle.isAlive)
        assertTrue(Files.exists(folder.root.toPath().resolve("$next.eof")))
        assertEquals(CliState.Stopped, runtime.state.value)
        assertFailsWith<IllegalStateException> { runtime.get() }
        Unit
    }

    @Test fun `unrelated redirect never receives the lease credential`() = runBlocking {
        val calls = CopyOnWriteArrayList<String>()
        val decoy = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        decoy.createContext("/") {
            calls.add(it.requestURI.path + ":" + it.requestHeaders.getFirst("Authorization"))
            it.responseHeaders.add("Location", "/trap")
            it.sendResponseHeaders(302, -1)
            it.close()
        }
        decoy.start()
        try {
            fixture(decoy = "http://127.0.0.1:${decoy.address.port}")
            runtime.get()
            assertTrue(calls.isNotEmpty())
            assertEquals(setOf("/api/info:" + okhttp3.Credentials.basic("opencode", "not-the-password")), calls.toSet())
        } finally { decoy.stop(0) }
    }

    @Test fun `unexpected exit invalidates the ready client`() = runBlocking {
        fixture()
        val pid = runtime.get().call("server.info").jsonObject.getValue("pid").jsonPrimitive.long
        ProcessHandle.of(pid).get().destroyForcibly()
        withTimeout(10_000) { runtime.state.first { it is CliState.Failed } }
        val restarted = runtime.get().call("server.info").jsonObject.getValue("pid").jsonPrimitive.long
        assertNotEquals(pid, restarted)
    }

    @Test fun `listening text cannot start a client and failures are deduplicated`() = runBlocking {
        val resolutions = CopyOnWriteArrayList<Boolean>()
        fixture(mode = "legacy-text-only", timeout = 1_500) { resolutions.add(it) }
        repeat(2) { assertFailsWith<IllegalStateException> { runtime.get() } }
        assertTrue(runtime.state.value is CliState.Failed)
        assertEquals(listOf(false), resolutions.toList())
    }

    @Test fun `an authenticated server reporting another version is not accepted`() = runBlocking {
        fixture(mode = "mismatch", timeout = 1_500)
        assertFailsWith<IllegalStateException> { runtime.get() }
        assertTrue(runtime.state.value is CliState.Failed)
    }
}
