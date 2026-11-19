package ai.kilocode.backend.cli

import ai.kilocode.backend.dev.KiloDevMode
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files
import kotlin.test.assertEquals
import kotlin.test.assertNull

class KiloBackendCliManagerEnvTest {
    @get:Rule val folder = TemporaryFolder()

    @Test fun `backend owns identity password config namespace and broker capabilities`() {
        val stripped = setOf("OPENCODE_PASSWORD", "KILO_SERVER_PASSWORD", "OPENCODE_SERVER_PASSWORD", "KILO_PARENT_PID",
            "KILO_CONFIG_DIR", "KILO_USE_RELEASE_CONFIG", "OPENCODE_DB", "KILO_AGENT_MANAGER_HOST", "KILO_BROWSER_BROKER_TOKEN",
            "KILO_NOTEBOOK_BROKER_TOKEN", "KILO_V2_TEST_BINARY", "KILO_DISABLE_CLAUDE_CODE", "OPENCODE_DISABLE_CLAUDE_CODE")
        val base = stripped.associateWith { "inherited" } + mapOf("KILO_CLIENT" to "vscode", "NODE_EXTRA_CA_CERTS" to "corp.pem")
        val cwd = folder.root.toPath()
        val env = cliEnvironment(base, cwd, "IDE build", true)
        stripped.forEach { assertNull(env[it], it) }
        assertEquals("jetbrains", env["KILO_CLIENT"])
        assertEquals("jetbrains", env["KILO_PLATFORM"])
        assertEquals("IDE build", env["KILOCODE_EDITOR_NAME"])
        assertEquals("corp.pem", env["NODE_EXTRA_CA_CERTS"])
        assertEquals("true", cliEnvironment(base, cwd, "IDE", false)["KILO_DISABLE_CLAUDE_CODE"])
    }

    @Test fun `dev checkout uses isolated entry and profile from backend storage`() {
        val root = folder.root.toPath()
        Files.createFile(Files.createDirectories(root.resolve("script")).resolve("dev-isolated.ts"))
        val storage = root.resolve("storage")
        val dev = requireNotNull(KiloDevMode.command(root.toString(), storage, emptyMap()))
        assertEquals(root.resolve("script/dev-isolated.ts").toString(), dev.argv.last())
        assertEquals(storage.resolve("profile").toString(), dev.env["KILO_V2_PROFILE"])
        assertNull(KiloDevMode.command(null, storage, emptyMap()))
    }
}
