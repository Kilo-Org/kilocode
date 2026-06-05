package ai.kilocode.client.settings

import ai.kilocode.client.settings.models.ModelsConfigurable
import ai.kilocode.client.settings.profile.UserProfileConfigurable
import com.intellij.ide.util.PropertiesComponent
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class KiloSettingsSelectionTest : BasePlatformTestCase() {

    override fun tearDown() {
        try {
            PropertiesComponent.getInstance(project).unsetValue(KiloSettingsSelection.SELECTED_CONFIGURABLE_KEY)
        } finally {
            super.tearDown()
        }
    }

    fun `test falls back to profile when no last settings page exists`() {
        assertEquals(UserProfileConfigurable.ID, KiloSettingsSelection.target(project))
    }

    fun `test falls back to profile when last page is not kilo`() {
        select("preferences.lookFeel")

        assertEquals(UserProfileConfigurable.ID, KiloSettingsSelection.target(project))
    }

    fun `test keeps last kilo root page`() {
        select(KiloSettingsConfigurable.ID)

        assertEquals(KiloSettingsConfigurable.ID, KiloSettingsSelection.target(project))
    }

    fun `test keeps last kilo child page`() {
        select(ModelsConfigurable.ID)

        assertEquals(ModelsConfigurable.ID, KiloSettingsSelection.target(project))
    }

    private fun select(id: String) {
        PropertiesComponent.getInstance(project).setValue(KiloSettingsSelection.SELECTED_CONFIGURABLE_KEY, id)
    }
}
