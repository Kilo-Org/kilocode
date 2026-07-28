package ai.kilocode.backend.cli

import ai.kilocode.backend.testing.TestLog
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
