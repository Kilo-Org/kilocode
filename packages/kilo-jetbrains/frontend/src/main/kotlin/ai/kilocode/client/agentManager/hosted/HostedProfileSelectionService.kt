package ai.kilocode.client.agentManager.hosted

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.RoamingType
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

internal interface HostedProfileSelectionStore {
    /** Returns a repository override, or null to use the backend default. */
    suspend fun selected(repositoryUrl: String): String?

    /**
     * Keeps only a non-default override. A future backend implementation may enqueue this write on
     * its service scope, leaving dialog lifecycle and selection precedence unchanged.
     */
    fun remember(repositoryUrl: String, selectedProfileID: String?, backendDefaultProfileID: String?)
}

@Service(Service.Level.APP)
@State(
    name = "KiloHostedProfileSelection",
    storages = [Storage("kiloHostedProfileSelection.xml", roamingType = RoamingType.DISABLED)],
)
internal class HostedProfileSelectionService :
    PersistentStateComponent<HostedProfileSelectionService.State>, HostedProfileSelectionStore {

    data class State(var profiles: MutableMap<String, String> = LinkedHashMap())

    @Volatile
    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = State(LinkedHashMap(state.profiles))
    }

    override suspend fun selected(repositoryUrl: String): String? = state.profiles[hostedRepositoryKey(repositoryUrl)]

    override fun remember(repositoryUrl: String, selectedProfileID: String?, backendDefaultProfileID: String?) {
        val key = hostedRepositoryKey(repositoryUrl)
        val id = selectedProfileID?.takeIf { it.isNotBlank() && it != backendDefaultProfileID }
        val profiles = LinkedHashMap(state.profiles)
        if (id == null) profiles.remove(key) else profiles[key] = id
        state = State(profiles)
    }
}
