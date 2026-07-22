package ai.kilocode.backend.rpc

import com.intellij.util.EnvironmentUtil
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KiloWorkspaceRpcApiImplConfigTest {

    @Test
    fun `global config target uses Kilo files at configured root`() = runBlocking {
        val root = Files.createTempDirectory("kilo-global-config")
        val restore = env(root)
        try {
            write(root.resolve("opencode.jsonc"))
            write(root.resolve("config.json"))

            val api = KiloWorkspaceRpcApiImpl()
            assertEquals(root.resolve("kilo.jsonc").toString(), api.globalConfigTarget().path)

            write(root.resolve("kilo.json"))
            assertEquals(root.resolve("kilo.json").toString(), api.globalConfigTarget().path)

            write(root.resolve("kilo.jsonc"))
            assertEquals(root.resolve("kilo.jsonc").toString(), api.globalConfigTarget().path)
        } finally {
            restore()
            delete(root)
        }
    }

    @Test
    fun `local config target uses Kilo directory and filename precedence`() = runBlocking {
        val root = Files.createTempDirectory("kilo-local-config")
        try {
            val api = KiloWorkspaceRpcApiImpl()
            write(root.resolve("kilo.json"))
            assertEquals(root.resolve("kilo.json").toString(), api.localConfigTarget(root.toString()).path)

            write(root.resolve(".kilocode/kilo.json"))
            assertEquals(root.resolve(".kilocode/kilo.json").toString(), api.localConfigTarget(root.toString()).path)

            write(root.resolve(".kilocode/kilo.jsonc"))
            assertEquals(root.resolve(".kilocode/kilo.jsonc").toString(), api.localConfigTarget(root.toString()).path)

            write(root.resolve(".kilo/kilo.json"))
            assertEquals(root.resolve(".kilo/kilo.json").toString(), api.localConfigTarget(root.toString()).path)

            write(root.resolve(".kilo/kilo.jsonc"))
            assertEquals(root.resolve(".kilo/kilo.jsonc").toString(), api.localConfigTarget(root.toString()).path)
        } finally {
            delete(root)
        }
    }

    @Test
    fun `local config target ignores legacy files and defaults to Kilo JSONC`() = runBlocking {
        val root = Files.createTempDirectory("kilo-local-config")
        try {
            write(root.resolve(".kilo/opencode.jsonc"))
            write(root.resolve(".kilocode/opencode.json"))
            write(root.resolve(".opencode/kilo.jsonc"))
            write(root.resolve("opencode.json"))
            write(root.resolve("config.json"))

            val target = KiloWorkspaceRpcApiImpl().localConfigTarget(root.toString())
            assertEquals(root.resolve(".kilo/kilo.jsonc").toString(), target.path)
            assertFalse(target.exists)
        } finally {
            delete(root)
        }
    }

    private fun env(root: Path): () -> Unit {
        val base = EnvironmentUtil.getEnvironmentMap()
        EnvironmentUtil.setEnvironmentLoader(CompletableDeferred(base + ("KILO_CONFIG_DIR" to root.toString())))
        return { EnvironmentUtil.setEnvironmentLoader(CompletableDeferred(base)) }
    }

    private fun write(path: Path) {
        Files.createDirectories(path.parent)
        Files.writeString(path, "{}")
        assertTrue(Files.exists(path))
    }

    private fun delete(root: Path) {
        Files.walk(root).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
