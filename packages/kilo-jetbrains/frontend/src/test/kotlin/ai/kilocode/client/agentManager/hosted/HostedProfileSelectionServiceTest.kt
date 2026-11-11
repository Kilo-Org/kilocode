package ai.kilocode.client.agentManager.hosted

import com.intellij.util.xmlb.XmlSerializer
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HostedProfileSelectionServiceTest {
    @Test
    fun `non-default selections are stored per repository`() = runBlocking {
        val service = HostedProfileSelectionService()

        service.remember("https://github.com/Kilo-Org/kilocode.git", "profile-a", "profile-default")
        service.remember("https://gitlab.com/Kilo-Org/other.git", "profile-b", null)

        assertEquals("profile-a", service.selected("git@github.com:kilo-org/KILOCODE.git"))
        assertEquals("profile-b", service.selected("git@gitlab.com:Kilo-Org/other.git"))
        assertNull(service.selected("https://github.com/Kilo-Org/other.git"))
    }

    @Test
    fun `default blank and absent selections remove an override`() = runBlocking {
        val service = HostedProfileSelectionService()
        val repo = "https://github.com/Kilo-Org/kilocode.git"

        service.remember(repo, "profile-a", "profile-default")
        service.remember(repo, "profile-default", "profile-default")
        assertNull(service.selected(repo))

        service.remember(repo, "profile-a", "profile-default")
        service.remember(repo, "", "profile-default")
        assertNull(service.selected(repo))

        service.remember(repo, "profile-a", "profile-default")
        service.remember(repo, null, "profile-default")
        assertNull(service.selected(repo))
    }

    @Test
    fun `state map round trips through IDE XML serialization`() = runBlocking {
        val service = HostedProfileSelectionService()
        service.remember("https://github.com/Kilo-Org/kilocode.git", "profile-a", null)

        val xml = XmlSerializer.serialize(service.getState())
        val state = XmlSerializer.deserialize(xml, HostedProfileSelectionService.State::class.java)
        val restored = HostedProfileSelectionService().apply { loadState(state) }

        assertEquals("profile-a", restored.selected("git@github.com:kilo-org/kilocode.git"))
    }
}
