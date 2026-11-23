package ai.kilocode.client.agentManager.hosted

internal class FakeHostedProfileSelectionStore : HostedProfileSelectionStore {
    data class Save(
        val repositoryUrl: String,
        val selectedProfileID: String?,
        val backendDefaultProfileID: String?,
    )

    var value: String? = null
    var error: Exception? = null
    val reads = mutableListOf<String>()
    val saves = mutableListOf<Save>()

    override suspend fun selected(repositoryUrl: String): String? {
        reads += repositoryUrl
        error?.let { throw it }
        return value
    }

    override fun remember(repositoryUrl: String, selectedProfileID: String?, backendDefaultProfileID: String?) {
        saves += Save(repositoryUrl, selectedProfileID, backendDefaultProfileID)
    }
}
