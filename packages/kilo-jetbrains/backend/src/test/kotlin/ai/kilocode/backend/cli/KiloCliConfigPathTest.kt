package ai.kilocode.backend.cli

import kotlin.test.Test
import kotlin.test.assertEquals
import java.io.File
import java.nio.file.Files

class KiloCliConfigPathTest {

    @Test
    fun `kilo config dir overrides XDG config home`() {
        val dir = Files.createTempDirectory("kilo-config-dir").toFile()
        val xdg = Files.createTempDirectory("kilo-xdg-config").toFile()

        val path = KiloCliConfigPath.resolve(
            mapOf(
                "KILO_CONFIG_DIR" to dir.absolutePath,
                "XDG_CONFIG_HOME" to xdg.absolutePath,
            ),
        )

        assertEquals(dir.absoluteFile, path.absoluteFile)
    }

    @Test
    fun `XDG config home resolves to kilo subdirectory`() {
        val xdg = Files.createTempDirectory("kilo-xdg-config").toFile()

        val path = KiloCliConfigPath.resolve(mapOf("XDG_CONFIG_HOME" to xdg.absolutePath))

        assertEquals(File(xdg, "kilo").absoluteFile, path.absoluteFile)
    }

    @Test
    fun `default config home matches CLI xdg fallback`() {
        val home = Files.createTempDirectory("kilo-home").toFile()

        val path = KiloCliConfigPath.resolve(mapOf("HOME" to home.absolutePath))

        assertEquals(File(File(home, ".config"), "kilo").absoluteFile, path.absoluteFile)
    }

    @Test
    fun `USERPROFILE backs up HOME for default config home`() {
        val home = Files.createTempDirectory("kilo-userprofile").toFile()

        val path = KiloCliConfigPath.resolve(
            mapOf(
                "HOME" to "",
                "USERPROFILE" to home.absolutePath,
            ),
        )

        assertEquals(File(File(home, ".config"), "kilo").absoluteFile, path.absoluteFile)
    }

    @Test
    fun `blank config env values are ignored`() {
        val home = Files.createTempDirectory("kilo-home").toFile()

        val path = KiloCliConfigPath.resolve(
            mapOf(
                "KILO_CONFIG_DIR" to " ",
                "XDG_CONFIG_HOME" to "",
                "HOME" to home.absolutePath,
            ),
        )

        assertEquals(File(File(home, ".config"), "kilo").absoluteFile, path.absoluteFile)
    }

    @Test
    fun `legacy settings file resolves under global config dir`() {
        val home = Files.createTempDirectory("kilo-home").toFile()

        val path = KiloCliConfigPath.legacySettingsFile(mapOf("HOME" to home.absolutePath))

        assertEquals(File(File(File(home, ".config"), "kilo"), "legacy-settings.json").absoluteFile, path.absoluteFile)
    }
}
