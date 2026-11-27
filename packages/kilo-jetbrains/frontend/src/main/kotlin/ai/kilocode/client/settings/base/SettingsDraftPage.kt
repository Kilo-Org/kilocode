package ai.kilocode.client.settings.base

internal interface SettingsDraftPage {
    fun modified(): Boolean = false
    fun applyDraft() = Unit
    fun resetDraft() = Unit
}
