package ai.kilocode.backend.cli

import ai.kilocode.backend.testing.TestLog
import ai.kilocode.log.KiloLog
import com.intellij.openapi.util.SystemInfo
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloProcessJobTest {

    @Test
    fun `missing JNA classes cannot prevent job initialization or retries`() {
        val parent = KiloProcessJob::class.java.classLoader
        for (prefix in listOf("com.sun.jna.", "com.sun.jna.win32.StdCallLibrary", "com.intellij.jna.JnaLoader")) {
            val missing = mutableListOf<String>()
            val log = TestLog()
            val loader = object : ClassLoader(parent) {
                override fun findClass(name: String): Class<*> {
                    val path = name.replace('.', '/') + ".class"
                    val bytes = parent.getResourceAsStream(path)?.use { it.readBytes() }
                        ?: throw ClassNotFoundException(name)
                    return defineClass(name, bytes, 0, bytes.size)
                }

                override fun loadClass(name: String, resolve: Boolean): Class<*> {
                    if (name.startsWith(prefix)) {
                        missing += name
                        throw ClassNotFoundException(name)
                    }
                    if (!name.startsWith("ai.kilocode.backend.cli.")) return super.loadClass(name, resolve)
                    return synchronized(getClassLoadingLock(name)) {
                        val type = findLoadedClass(name) ?: findClass(name)
                        if (resolve) resolveClass(type)
                        type
                    }
                }
            }
            val type = Class.forName(KiloProcessJob::class.java.name, true, loader)
            val companion = type.getField("Companion").get(null)
            val assign = companion.javaClass.getMethod("assign", Long::class.javaPrimitiveType, KiloLog::class.java)
            repeat(2) {
                val count = log.messages.size
                assertNull(assign.invoke(companion, 0L, log), "Missing $prefix must preserve fallback")
                if (SystemInfo.isWindows) {
                    assertTrue(
                        log.messages.drop(count).any { it.startsWith("WARN:") },
                        "Missing $prefix must log a warning on every attempt",
                    )
                }
            }
            if (SystemInfo.isWindows) assertTrue(missing.isNotEmpty(), "The native path must attempt to load $prefix")
            if (!SystemInfo.isWindows) assertTrue(missing.isEmpty(), "Non-Windows must not load JNA: $missing")
        }
    }

    /**
     * The kill-on-close job is Windows-only. Everywhere else (including CI) [KiloProcessJob.assign]
     * must be an inert no-op that never touches native code — callers rely on that to fall back to
     * their existing process-tree kill.
     */
    @Test
    fun `assign is a no-op on non-Windows platforms`() {
        if (SystemInfo.isWindows) return
        assertNull(KiloProcessJob.assign(4321L, TestLog()))
    }

    /**
     * Windows-only end-to-end check of the native path: assigns a disposable child (never the test
     * JVM) to a kill-on-close job and asserts closing the job terminates it. Exercises the struct
     * layout, JNA signatures, assignment, and handle cleanup on the one platform where they run.
     */
    @Test
    fun `closing the job terminates a disposable child on Windows`() {
        if (!SystemInfo.isWindows) return
        val child = ProcessBuilder("cmd.exe", "/c", "ping -n 30 127.0.0.1 >NUL").start()
        try {
            val job = assertNotNull(KiloProcessJob.assign(child.pid(), TestLog()), "job assigned on Windows")
            assertTrue(child.isAlive, "child still running before job close")
            job.close()
            assertTrue(child.waitFor(15, TimeUnit.SECONDS), "child exits after kill-on-close")
        } finally {
            child.destroyForcibly()
        }
    }
}
