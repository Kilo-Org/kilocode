package ai.kilocode.backend.rpc

import ai.kilocode.rpc.dto.SetupScriptKind
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.writeText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Covers [resolveSetupScript] directly (pure, no [com.intellij.openapi.util.SystemInfo]) and
 * [KiloWorkspaceRpcApiImpl.setupScriptTarget] (the RPC method, which needs no [com.intellij.openapi.project.Project]
 * unlike `openSetupScript`, so it -- like the rest of this file's tests -- runs without a platform
 * test fixture).
 */
class SetupScriptResolutionTest {
    private val dirs = mutableListOf<Path>()

    @AfterTest
    fun tearDown() {
        dirs.forEach { delete(it) }
        dirs.clear()
    }

    @Test
    fun `posix prefers setup-script over setup-script sh`() {
        val root = repo()
        write(root, "setup-script")
        write(root, "setup-script.sh")

        val target = resolveSetupScript(root, windows = false)

        assertTrue(target.exists)
        assertEquals(SetupScriptKind.POSIX, target.kind)
        assertEquals(root.resolve(".kilo").resolve("setup-script").toString(), target.path)
    }

    @Test
    fun `posix falls back to setup-script sh when only that exists`() {
        val root = repo()
        write(root, "setup-script.sh")

        val target = resolveSetupScript(root, windows = false)

        assertTrue(target.exists)
        assertEquals(SetupScriptKind.POSIX, target.kind)
        assertEquals(root.resolve(".kilo").resolve("setup-script.sh").toString(), target.path)
    }

    @Test
    fun `posix default is setup-script when nothing exists`() {
        val root = repo()

        val target = resolveSetupScript(root, windows = false)

        assertFalse(target.exists)
        assertEquals(SetupScriptKind.POSIX, target.kind)
        assertEquals(root.resolve(".kilo").resolve("setup-script").toString(), target.path)
    }

    @Test
    fun `windows prefers ps1 over cmd and bat`() {
        val root = repo()
        write(root, "setup-script.ps1")
        write(root, "setup-script.cmd")
        write(root, "setup-script.bat")

        val target = resolveSetupScript(root, windows = true)

        assertTrue(target.exists)
        assertEquals(SetupScriptKind.POWERSHELL, target.kind)
        assertEquals(root.resolve(".kilo").resolve("setup-script.ps1").toString(), target.path)
    }

    @Test
    fun `windows prefers cmd over bat when ps1 is absent`() {
        val root = repo()
        write(root, "setup-script.cmd")
        write(root, "setup-script.bat")

        val target = resolveSetupScript(root, windows = true)

        assertTrue(target.exists)
        assertEquals(SetupScriptKind.CMD, target.kind)
        assertEquals(root.resolve(".kilo").resolve("setup-script.cmd").toString(), target.path)
    }

    @Test
    fun `windows default is setup-script ps1 when nothing exists`() {
        val root = repo()

        val target = resolveSetupScript(root, windows = true)

        assertFalse(target.exists)
        assertEquals(SetupScriptKind.POWERSHELL, target.kind)
        assertEquals(root.resolve(".kilo").resolve("setup-script.ps1").toString(), target.path)
    }

    @Test
    fun `posix candidate is not resolved on windows`() {
        val root = repo()
        write(root, "setup-script")
        write(root, "setup-script.sh")

        val target = resolveSetupScript(root, windows = true)

        assertFalse(target.exists)
        assertEquals(SetupScriptKind.POWERSHELL, target.kind)
    }

    @Test
    fun `windows candidates are not resolved on posix`() {
        val root = repo()
        write(root, "setup-script.ps1")
        write(root, "setup-script.cmd")
        write(root, "setup-script.bat")

        val target = resolveSetupScript(root, windows = false)

        assertFalse(target.exists)
        assertEquals(SetupScriptKind.POSIX, target.kind)
    }

    @Test
    fun `rpc method resolves the setup script for a directory`() = runBlocking {
        val root = repo()
        write(root, "setup-script")

        val target = KiloWorkspaceRpcApiImpl().setupScriptTarget(root.toString())

        assertTrue(target.exists)
        assertEquals(root.resolve(".kilo").resolve("setup-script").toString(), target.path)
    }

    private fun repo(): Path {
        val dir = Files.createTempDirectory("kilo-setup-script")
        dirs.add(dir)
        return dir
    }

    private fun write(root: Path, name: String) {
        val dir = root.resolve(".kilo")
        Files.createDirectories(dir)
        dir.resolve(name).writeText("# test\n")
    }

    private fun delete(dir: Path) {
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
