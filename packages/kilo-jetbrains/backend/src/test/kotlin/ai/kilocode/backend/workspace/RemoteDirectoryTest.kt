package ai.kilocode.backend.workspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RemoteDirectoryTest {

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
}
