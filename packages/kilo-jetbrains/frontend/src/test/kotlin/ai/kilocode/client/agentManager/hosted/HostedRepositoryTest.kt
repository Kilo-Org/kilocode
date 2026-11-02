package ai.kilocode.client.agentManager.hosted

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HostedRepositoryTest {
    @Test
    fun `github https and ssh remotes keep only owner and repository`() {
        assertEquals("Kilo-Org/kilocode", hostedRepository("https://github.com/Kilo-Org/kilocode.git", null).repo)
        assertEquals("Kilo-Org/kilocode", hostedRepository("git@github.com:Kilo-Org/kilocode.git", null).repo)
        assertEquals("Kilo-Org/kilocode", hostedRepository("ssh://git@github.com/Kilo-Org/kilocode.git", null).repo)
        assertEquals("github", hostedRepository("git@github.com:Kilo-Org/kilocode.git", "main").type)
        assertEquals("main", hostedRepository("git@github.com:Kilo-Org/kilocode.git", "main").branch)
    }

    @Test
    fun `non github remotes keep a clone url`() {
        val gitlab = hostedRepository("git@gitlab.com:Kilo-Org/example.git", null)
        assertEquals("gitlab", gitlab.type)
        assertEquals("ssh://git@gitlab.com/Kilo-Org/example", gitlab.url)
        assertNull(gitlab.repo)

        val git = hostedRepository("https://example.com/Kilo-Org/example.git", null)
        assertEquals("git", git.type)
        assertEquals("https://example.com/Kilo-Org/example", git.url)
    }

    @Test
    fun `short github values keep the repository path`() {
        val repo = hostedRepository("Kilo-Org/kilocode", null)

        assertEquals("github", repo.type)
        assertEquals("Kilo-Org/kilocode", repo.repo)
    }
}
