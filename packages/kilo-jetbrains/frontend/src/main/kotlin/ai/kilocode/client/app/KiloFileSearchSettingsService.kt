package ai.kilocode.client.app

import ai.kilocode.rpc.dto.FileSearchBackendDto
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

@Service(Service.Level.APP)
@State(
    name = "KiloFileSearchSettings",
    storages = [Storage("kiloFileSearchSettings.xml")],
)
class KiloFileSearchSettingsService : PersistentStateComponent<KiloFileSearchSettingsService.State> {

    data class State(var backend: String? = null)

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    fun backend(): FileSearchBackendDto = when (state.backend) {
        "intellij" -> FileSearchBackendDto.INTELLIJ
        else -> FileSearchBackendDto.KILO
    }

    fun setBackend(value: FileSearchBackendDto) {
        state.backend = when (value) {
            FileSearchBackendDto.KILO -> "kilo"
            FileSearchBackendDto.INTELLIJ -> "intellij"
        }
    }

    fun useIntellij(): Boolean = backend() == FileSearchBackendDto.INTELLIJ

    fun setUseIntellij(value: Boolean) {
        setBackend(if (value) FileSearchBackendDto.INTELLIJ else FileSearchBackendDto.KILO)
    }

    companion object {
        fun getInstance(): KiloFileSearchSettingsService = service()
    }
}
