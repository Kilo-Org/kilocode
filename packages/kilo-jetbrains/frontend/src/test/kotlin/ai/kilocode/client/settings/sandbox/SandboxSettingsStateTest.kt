package ai.kilocode.client.settings.sandbox

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.SandboxConfigDto
import ai.kilocode.rpc.dto.SandboxNetworkDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SandboxSettingsStateTest {
    @Test
    fun `missing enabled value displays sandbox controls as exposed`() {
        val draft = sandboxDraft(ConfigDto())

        assertNull(draft.enabled)
        assertTrue(exposed(draft))
        assertEquals(SandboxNetworkDto.DENY, effectiveNetwork(draft))
        assertNull(patch(draft, draft))
    }

    @Test
    fun `explicit false hides sandbox controls`() {
        val draft = sandboxDraft(ConfigDto(sandbox = SandboxConfigDto(enabled = false)))

        assertFalse(exposed(draft))
    }

    @Test
    fun `patch includes only changed global sandbox fields`() {
        val from = SandboxDraft(enabled = null, network = null)
        val to = SandboxDraft(
            enabled = false,
            network = SandboxNetworkDto.ALLOW,
            hosts = listOf("api.github.com:443"),
            paths = listOf("~/output"),
        )

        val sandbox = patch(from, to)?.sandbox
        assertEquals(false, sandbox?.enabled)
        assertEquals(SandboxNetworkDto.ALLOW, sandbox?.network)
        assertEquals(listOf("api.github.com:443"), sandbox?.allowedHosts)
        assertEquals(listOf("~/output"), sandbox?.writablePaths)
    }

    @Test
    fun `destination normalization accepts exact hosts and ports`() {
        assertEquals("github.com:443", normalizeDestination("GitHub.COM."))
        assertEquals("api.github.com:8443", normalizeDestination("api.github.com:8443"))
    }

    @Test
    fun `destination normalization rejects widening and ambiguous values`() {
        val invalid = listOf(
            "https://github.com",
            "*.github.com",
            ".github.com",
            "github.com/path",
            "github.com?x=1",
            "user@github.com",
            " github.com",
            "github.com ",
            "github.com:0",
            "github.com:65536",
            "127.0.0.1",
            "[::1]",
        )

        invalid.forEach { assertNull(normalizeDestination(it), it) }
    }
}
