package ai.kilocode.jetbrains.util

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File
import java.nio.file.Files

class NodeExecutableFinderTest {
    private val tempDirs = mutableListOf<File>()

    @After
    fun tearDown() {
        tempDirs.forEach { it.deleteRecursively() }
        tempDirs.clear()
    }

    @Test
    fun `findNodeExecutable prefers bundled node executable`() {
        val root = createTempDir("node-finder-bundled")
        val bundledNode = File(root, ".bin/node")
        createNodeFile(bundledNode)

        val detected = NodeExecutableFinder.findNodeExecutable(
            bundledNodeModulesDir = root.absolutePath,
            osInfo = NodeExecutableFinder.OsInfo(isWindows = false, isMac = true),
            envVars = emptyMap(),
            pathLookup = { _ -> null },
        )

        assertEquals(bundledNode.absolutePath, detected)
    }

    @Test
    fun `findNodeExecutable uses IntelliJ PATH lookup result when available`() {
        val root = createTempDir("node-finder-lookup")
        val pathNode = File(root, "node")
        createNodeFile(pathNode)

        val detected = NodeExecutableFinder.findNodeExecutable(
            bundledNodeModulesDir = null,
            osInfo = NodeExecutableFinder.OsInfo(isWindows = false, isMac = false),
            envVars = emptyMap(),
            pathLookup = { _ -> pathNode.absolutePath },
        )

        assertEquals(pathNode.absolutePath, detected)
    }

    @Test
    fun `findNodeExecutable scans PATH entries when IntelliJ lookup fails`() {
        val root = createTempDir("node-finder-path")
        val binDir = File(root, "bin").apply { mkdirs() }
        val nodeInPath = File(binDir, "node")
        createNodeFile(nodeInPath)

        val detected = NodeExecutableFinder.findNodeExecutable(
            bundledNodeModulesDir = null,
            osInfo = NodeExecutableFinder.OsInfo(isWindows = false, isMac = false),
            envVars = mapOf("PATH" to binDir.absolutePath),
            pathLookup = { _ -> null },
        )

        assertEquals(nodeInPath.absolutePath, detected)
    }

    @Test
    fun `findNodeExecutable finds latest nvm node when PATH is unavailable`() {
        val home = createTempDir("node-finder-home")
        val olderNode = File(home, ".nvm/versions/node/v18.20.0/bin/node")
        val latestNode = File(home, ".nvm/versions/node/v20.19.0/bin/node")
        createNodeFile(olderNode)
        createNodeFile(latestNode)

        val detected = NodeExecutableFinder.findNodeExecutable(
            bundledNodeModulesDir = null,
            osInfo = NodeExecutableFinder.OsInfo(isWindows = false, isMac = true),
            envVars = mapOf("HOME" to home.absolutePath),
            pathLookup = { _ -> null },
        )

        assertEquals(latestNode.absolutePath, detected)
    }

    @Test
    fun `findNodeExecutable uses explicit environment override`() {
        val root = createTempDir("node-finder-env")
        val envNode = File(root, "custom/node")
        createNodeFile(envNode)

        val detected = NodeExecutableFinder.findNodeExecutable(
            bundledNodeModulesDir = null,
            osInfo = NodeExecutableFinder.OsInfo(isWindows = false, isMac = false),
            envVars = mapOf("KILOCODE_NODE_PATH" to envNode.absolutePath),
            pathLookup = { _ -> null },
        )

        assertEquals(envNode.absolutePath, detected)
    }

    @Test
    fun `findNodeExecutable supports Windows common install directories`() {
        val root = createTempDir("node-finder-windows")
        val programFiles = File(root, "Program Files").apply { mkdirs() }
        val windowsNode = File(programFiles, "nodejs/node.exe")
        createNodeFile(windowsNode, executable = false)

        val detected = NodeExecutableFinder.findNodeExecutable(
            bundledNodeModulesDir = null,
            osInfo = NodeExecutableFinder.OsInfo(isWindows = true, isMac = false),
            envVars = mapOf("ProgramFiles" to programFiles.absolutePath),
            pathLookup = { _ -> null },
        )

        assertNotNull(detected)
        assertEquals(windowsNode.absolutePath, detected)
    }

    private fun createTempDir(prefix: String): File {
        return Files.createTempDirectory(prefix).toFile().also { tempDirs.add(it) }
    }

    private fun createNodeFile(path: File, executable: Boolean = true) {
        path.parentFile.mkdirs()
        path.writeText("node")
        if (executable) {
            path.setExecutable(true)
        }
    }
}
