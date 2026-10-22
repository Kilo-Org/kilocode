package ai.kilocode.client.autocomplete

import ai.kilocode.rpc.dto.LegacyAutocompleteSettingsDto
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

@Service(Service.Level.APP)
@State(
    name = "KiloAutocompleteSettings",
    storages = [Storage("kiloAutocompleteSettings.xml")],
)
class KiloAutocompleteSettingsService : PersistentStateComponent<KiloAutocompleteSettingsService.State> {

    data class State(
        var enableAutoTrigger: Boolean? = null,
        var enableSmartInlineTaskKeybinding: Boolean? = null,
        var enableChatAutocomplete: Boolean? = null,
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    fun applyLegacy(settings: LegacyAutocompleteSettingsDto) {
        settings.enableAutoTrigger?.let { state.enableAutoTrigger = it }
        settings.enableSmartInlineTaskKeybinding?.let { state.enableSmartInlineTaskKeybinding = it }
        settings.enableChatAutocomplete?.let { state.enableChatAutocomplete = it }
    }

    companion object {
        fun getInstance(): KiloAutocompleteSettingsService = service()
    }
}
