package ai.kilocode.client.agentManager.hosted

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
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
    fun `repository name drops credentials host and git suffix`() {
        assertEquals("kilocode", hostedRepositoryName("git@github.com:Kilo-Org/kilocode.git"))
        assertEquals("kilocode", hostedRepositoryName("https://github.com/Kilo-Org/kilocode.git"))
        assertEquals("kilocode", hostedRepositoryName("Kilo-Org/kilocode"))
    }

    @Test
    fun `short github values keep the repository path`() {
        val repo = hostedRepository("Kilo-Org/kilocode", null)

        assertEquals("github", repo.type)
        assertEquals("Kilo-Org/kilocode", repo.repo)
    }

    @Test
    fun `github remotes share a credential-free persistent key`() {
        val key = hostedRepositoryKey("https://github.com/Kilo-Org/kilocode.git")

        assertEquals("github:kilo-org/kilocode", key)
        assertEquals(key, hostedRepositoryKey("git@github.com:kilo-org/KILOCODE.git"))
        assertEquals(key, hostedRepositoryKey("ssh://git@github.com/Kilo-Org/kilocode.git/"))
        assertEquals(key, hostedRepositoryKey("https://user:secret@github.com/Kilo-Org/kilocode.git?token=hidden"))
        assertFalse(key.contains("secret"))
        assertFalse(key.contains("token"))
    }

    @Test
    fun `non github persistent keys ignore transport but preserve host path case and port`() {
        val key = hostedRepositoryKey("git@gitlab.com:Kilo-Org/example.git")

        assertEquals("gitlab.com/Kilo-Org/example", key)
        assertEquals(key, hostedRepositoryKey("https://gitlab.com/Kilo-Org/example.git"))
        assertNotEquals(key, hostedRepositoryKey("https://gitlab.com/kilo-org/example.git"))
        assertNotEquals(key, hostedRepositoryKey("https://gitlab.com:8443/Kilo-Org/example.git"))
        assertNotEquals(key, hostedRepositoryKey("https://example.com/Kilo-Org/example.git"))
        assertEquals(key, hostedRepositoryKey("git@gitlab.com:Kilo-Org/example.git?token=hidden"))
    }

    @Test
    fun `persistent keys normalize standard ports and retain nonstandard ports`() {
        val github = hostedRepositoryKey("https://github.com/Kilo-Org/kilocode.git")
        val gitlab = hostedRepositoryKey("https://gitlab.com/Kilo-Org/example.git")

        assertEquals(github, hostedRepositoryKey("https://github.com:443/Kilo-Org/kilocode.git"))
        assertEquals(github, hostedRepositoryKey("ssh://git@github.com:22/Kilo-Org/kilocode.git"))
        assertNotEquals(github, hostedRepositoryKey("https://github.com:8443/Kilo-Org/kilocode.git"))
        assertEquals(gitlab, hostedRepositoryKey("https://gitlab.com:443/Kilo-Org/example.git"))
        assertEquals(gitlab, hostedRepositoryKey("ssh://git@gitlab.com:22/Kilo-Org/example.git"))
    }

    @Test
    fun `unparseable persistent keys do not retain raw repository values`() {
        val key = hostedRepositoryKey("local path with credentials secret")

        assertEquals("unknown:", key.substringBefore(':') + ":")
        assertFalse(key.contains("secret"))
    }
}
