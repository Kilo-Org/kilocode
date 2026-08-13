package ai.kilocode.client.settings.context

import ai.kilocode.rpc.dto.CompactionConfigDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.WatcherConfigDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Extends BasePlatformTestCase so the IntelliJ Application is initialized: ContextDraft's default
// editor value reads a PropertiesComponent app service, which is null in a plain unit test.
class ContextSettingsStateTest : BasePlatformTestCase() {
    fun `test draft reads context config`() {
        val draft = contextDraft(ConfigDto(
            watcher = WatcherConfigDto(ignore = listOf("**/dist/**")),
            compaction = CompactionConfigDto(auto = true, threshold_percent = 75.0, prune = true),
        ))

        assertEquals(true, draft.auto)
        assertEquals("75", draft.threshold)
        assertEquals(true, draft.prune)
        assertEquals(listOf("**/dist/**"), draft.ignore)
    }

    fun `test unchanged draft emits no patch`() {
        val draft = ContextDraft(auto = true, threshold = "75", prune = false, ignore = listOf("tmp/**"))

        assertEquals(false, patch(draft, draft)?.let(::changed))
    }

    fun `test boolean false values are emitted`() {
        val from = ContextDraft(auto = true, prune = true)
        val to = ContextDraft(auto = false, prune = false)
        val patch = patch(from, to)

        assertEquals(false, patch?.compaction?.auto)
        assertEquals(false, patch?.compaction?.prune)
    }

    fun `test threshold set and clear use explicit semantics`() {
        val from = ContextDraft(threshold = "")
        val set = ContextDraft(threshold = "80")
        val clear = ContextDraft(threshold = "")

        assertEquals(80.0, patch(from, set)?.compaction?.threshold_percent)
        assertEquals(listOf("threshold_percent"), patch(set, clear)?.compaction?.clear)
        assertNull(patch(set, clear)?.compaction?.threshold_percent)
    }

    fun `test watcher empty list is emitted`() {
        val from = ContextDraft(ignore = listOf("**/dist/**"))
        val to = ContextDraft(ignore = emptyList())

        assertEquals(emptyList<String>(), patch(from, to)?.watcher?.ignore)
    }

    fun `test invalid threshold prevents patch without looking like no changes`() {
        val from = ContextDraft(threshold = "50")
        val to = ContextDraft(auto = true, threshold = "101", prune = true, ignore = listOf("tmp/**"))

        assertEquals(ThresholdStatus.INVALID, thresholdStatus(to.threshold))
        assertNull(patch(from, to))
    }

    fun `test saved match normalizes threshold formatting`() {
        assertTrue(savedMatches(ContextDraft(threshold = "75"), ContextDraft(threshold = "75.0")))
        assertFalse(savedMatches(ContextDraft(threshold = "75"), ContextDraft(threshold = "76")))
    }
}
