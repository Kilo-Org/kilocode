package ai.kilocode.client.settings.checkpoints

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class CheckpointsConfigurableTest : BasePlatformTestCase() {
    fun `test id matches xml registration`() {
        val cfg = CheckpointsConfigurable()

        assertEquals("ai.kilocode.jetbrains.settings.checkpoints", cfg.id)
    }

    fun `test page is a searchable draft page that is unmodified before app state arrives`() {
        val cfg: Configurable = CheckpointsConfigurable()

        assertTrue(cfg is SearchableConfigurable)
        assertFalse(cfg.isModified)
        cfg.apply()
        assertFalse(cfg.isModified)
    }
}
