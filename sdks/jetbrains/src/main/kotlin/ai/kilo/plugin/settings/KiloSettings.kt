package ai.kilo.plugin.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

/**
 * Persistent settings for the Kilo plugin.
 * Stores user preferences and frecency data for file autocomplete.
 */
@State(
    name = "KiloSettings",
    storages = [Storage("KiloSettings.xml")]
)
@Service(Service.Level.APP)
class KiloSettings : PersistentStateComponent<KiloSettings.State> {

    private var state = State()

    /**
     * Persistent state data class.
     */
    data class State(
        var kiloExecutablePath: String = "",
        var autoStartServer: Boolean = true,
        var defaultAgent: String? = null,
        var serverPort: Int? = null,
        // Frecency data: Map<filePath, serialized FrecencyData>
        var fileFrecencyCount: MutableMap<String, Int> = mutableMapOf(),
        var fileFrecencyLastAccess: MutableMap<String, Long> = mutableMapOf()
    )

    override fun getState(): State = state

    override fun loadState(state: State) {
        XmlSerializerUtil.copyBean(state, this.state)
    }

    /**
     * Record file access for frecency scoring.
     */
    fun recordFileAccess(path: String) {
        val count = state.fileFrecencyCount.getOrDefault(path, 0)
        state.fileFrecencyCount[path] = count + 1
        state.fileFrecencyLastAccess[path] = System.currentTimeMillis()
    }

    /**
     * Get frecency score for a file path.
     * Higher score = more frequently/recently accessed.
     */
    fun getFrecencyScore(path: String): Double {
        val count = state.fileFrecencyCount.getOrDefault(path, 0)
        val lastAccess = state.fileFrecencyLastAccess.getOrDefault(path, 0L)

        if (count == 0) return 0.0

        // Decay factor based on time since last access
        val now = System.currentTimeMillis()
        val hoursSinceAccess = (now - lastAccess) / (1000.0 * 60 * 60)
        val decay = 1.0 / (1.0 + hoursSinceAccess / 24.0) // Half-life of ~24 hours

        return count * decay
    }

    /**
     * Clear frecency data (for testing or reset).
     */
    fun clearFrecencyData() {
        state.fileFrecencyCount.clear()
        state.fileFrecencyLastAccess.clear()
    }

    companion object {
        fun getInstance(): KiloSettings {
            return ApplicationManager.getApplication().getService(KiloSettings::class.java)
        }
    }
}
