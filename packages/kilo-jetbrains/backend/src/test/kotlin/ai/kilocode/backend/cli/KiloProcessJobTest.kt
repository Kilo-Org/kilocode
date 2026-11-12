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
     * Off Windows, loading the class must not link the kernel32 mapping: its supertype
     * `com.sun.jna.win32.StdCallLibrary` could not be resolved from the plugin on IntelliJ 2026.3 EAP
     * on macOS. Loads this package through a loader that hides `com.sun.jna.win32`.
     */
    @Test
    fun `assign does not link the kernel32 mapping on non-Windows platforms`() {
        if (SystemInfo.isWindows) return
        val cls = Class.forName(KiloProcessJob::class.java.name, true, NoWin32(javaClass.classLoader))
        val companion = cls.getField("Companion").get(null)
        val assign = companion.javaClass.getMethod("assign", Long::class.javaPrimitiveType, KiloLog::class.java)
        assertNull(assign.invoke(companion, 4321L, TestLog()))
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

    /** Defines this package's classes itself and cannot see `com.sun.jna.win32`; the rest comes from [parent]. */
    private class NoWin32(parent: ClassLoader) : ClassLoader(parent) {
        override fun loadClass(name: String, resolve: Boolean): Class<*> {
            if (name.startsWith("com.sun.jna.win32.")) throw ClassNotFoundException(name)
            if (!name.startsWith(KiloProcessJob::class.java.packageName + ".")) return super.loadClass(name, resolve)
            synchronized(getClassLoadingLock(name)) {
                findLoadedClass(name)?.let { return it }
                val bytes = parent.getResourceAsStream(name.replace('.', '/') + ".class")?.use { it.readBytes() }
                    ?: throw ClassNotFoundException(name)
                return defineClass(name, bytes, 0, bytes.size)
            }
        }
    }
}
