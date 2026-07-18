package ai.kilocode.backend.cli

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Properties
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class KiloRepoCliTest {
    @TempDir
    lateinit var dir: File

    @Test
    fun `extracts cached repo cli and force re-extracts`() = runBlocking {
        val first = archive("#!/bin/old\n")
        val next = archive("#!/bin/new\n")
        val cli = KiloRepoCli.extract(false, dir) { ByteArrayInputStream(first) }

        assertTrue(cli.isFile)
        assertEquals("#!/bin/old\n", cli.readText())
        assertTrue(File(cli.parentFile, "kilo-sandbox-mutation-worker.js").isFile)
        assertTrue(File(dir, ".complete").isFile)

        val cached = KiloRepoCli.extract(false, dir) { ByteArrayInputStream(next) }
        assertEquals(cli.absolutePath, cached.absolutePath)
        assertEquals("#!/bin/old\n", cached.readText())

        val forced = KiloRepoCli.extract(true, dir) { ByteArrayInputStream(next) }
        assertEquals(cli.absolutePath, forced.absolutePath)
        assertEquals("#!/bin/new\n", forced.readText())
    }

    @Test
    fun `rejects archive entries that escape root`() = runBlocking {
        val ex = assertFailsWith<IllegalStateException> {
            KiloRepoCli.extract(false, dir) { ByteArrayInputStream(archive(entry = "../../../bad")) }
        }

        assertContains(ex.message.orEmpty(), "escapes target directory")
    }

    @Test
    fun `pinned defaults true unless explicitly false`() {
        assertEquals(true, KiloProps.pinned(Properties()))
        assertEquals(true, KiloProps.pinned(Properties().apply { setProperty("cli.pinned", "true") }))
        assertEquals(false, KiloProps.pinned(Properties().apply { setProperty("cli.pinned", "false") }))
    }

    private fun archive(script: String = "#!/bin/sh\n", entry: String = "bin/${KiloCliPlatform.exe()}"): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry(entry))
            zip.write(script.toByteArray())
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("bin/kilo-sandbox-mutation-worker.js"))
            zip.write("worker".toByteArray())
            zip.closeEntry()
        }
        return out.toByteArray()
    }
}
