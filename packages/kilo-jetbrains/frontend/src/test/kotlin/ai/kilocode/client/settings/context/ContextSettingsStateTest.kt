package ai.kilocode.client.settings.context

import ai.kilocode.rpc.dto.CompactionConfigDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.WatcherConfigDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ContextSettingsStateTest {
    @Test
    fun `draft reads context config`() {
        val draft = contextDraft(ConfigDto(
            watcher = WatcherConfigDto(ignore = listOf("**/dist/**")),
            compaction = CompactionConfigDto(auto = true, threshold_percent = 75.0, prune = true),
        ))

        assertEquals(true, draft.auto)
        assertEquals("75", draft.threshold)
        assertEquals(true, draft.prune)
        assertEquals(listOf("**/dist/**"), draft.ignore)
    }

    @Test
    fun `unchanged draft emits no patch`() {
        val draft = ContextDraft(auto = true, threshold = "75", prune = false, ignore = listOf("tmp/**"))

        assertFalse(changed(patch(draft, draft)))
    }

    @Test
    fun `boolean false values are emitted`() {
        val from = ContextDraft(auto = true, prune = true)
        val to = ContextDraft(auto = false, prune = false)
        val patch = patch(from, to)

        assertEquals(false, patch.compaction?.auto)
        assertEquals(false, patch.compaction?.prune)
    }

    @Test
    fun `threshold set and clear use explicit semantics`() {
        val from = ContextDraft(threshold = "")
        val set = ContextDraft(threshold = "80")
        val clear = ContextDraft(threshold = "")

        assertEquals(80.0, patch(from, set).compaction?.threshold_percent)
        assertEquals(listOf("threshold_percent"), patch(set, clear).compaction?.clear)
        assertNull(patch(set, clear).compaction?.threshold_percent)
    }

    @Test
    fun `watcher empty list is emitted`() {
        val from = ContextDraft(ignore = listOf("**/dist/**"))
        val to = ContextDraft(ignore = emptyList())

        assertEquals(emptyList(), patch(from, to).watcher?.ignore)
    }

    @Test
    fun `invalid threshold prevents patch`() {
        val from = ContextDraft(threshold = "50")
        val to = ContextDraft(threshold = "101")

        assertEquals(ThresholdStatus.INVALID, thresholdStatus(to.threshold))
        assertFalse(changed(patch(from, to)))
    }

    @Test
    fun `saved match normalizes threshold formatting`() {
        assertTrue(savedMatches(ContextDraft(threshold = "75"), ContextDraft(threshold = "75.0")))
        assertFalse(savedMatches(ContextDraft(threshold = "75"), ContextDraft(threshold = "76")))
    }
}
