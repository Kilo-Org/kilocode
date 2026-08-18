package ai.kilocode.backend.workspace

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RemoteDirectoryTest {

    private val flag = "kilo.dev.forceUnsupportedWorkspace"

    @AfterTest
    fun tearDown() {
        System.clearProperty(flag)
    }

    @Test
    fun `detects devcontainer virtual path`() {
        val dir = "/${'$'}devcontainer.ij/abc@u~run~user~1001~podman~podman.sock/workspaces/project"
        assertEquals("devcontainer_virtual_filesystem", RemoteDirectory.detect(dir))
    }

    @Test
    fun `detects wsl roots`() {
        assertEquals("wsl_virtual_filesystem", RemoteDirectory.detect("\\\\wsl${'$'}\\Ubuntu\\home\\user\\x"))
        assertEquals("wsl_virtual_filesystem", RemoteDirectory.detect("\\\\wsl.localhost\\Ubuntu\\home\\user\\x"))
    }

    @Test
    fun `detects invalid path`() {
        assertEquals("invalid_virtual_path", RemoteDirectory.detect("bad" + Char.MIN_VALUE + "path"))
    }

    @Test
    fun `passes normal local and container paths`() {
        assertNull(RemoteDirectory.detect("/Users/dev/project"))
        assertNull(RemoteDirectory.detect("/workspaces/project"))
    }

    @Test
    fun `forced flag overrides any directory`() {
        System.setProperty(flag, "true")
        assertEquals("devcontainer_virtual_filesystem", RemoteDirectory.detect("/Users/dev/project"))

        System.setProperty(flag, "custom_reason")
        assertEquals("custom_reason", RemoteDirectory.detect("/Users/dev/project"))

        System.setProperty(flag, "false")
        assertNull(RemoteDirectory.detect("/Users/dev/project"))
    }
}
