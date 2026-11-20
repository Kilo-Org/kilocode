package ai.kilocode.client.settings.base

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SettingsDraftStateTest {
    @Test
    fun `baseline edit and reset`() {
        val state = SettingsDraftState("old")

        state.update { "new" }
        assertTrue(state.modified())
        state.reset()

        assertEquals("old", state.draft)
        assertFalse(state.modified())
    }

    @Test
    fun `pending target is not modified`() {
        val state = SettingsDraftState("old")
        state.update { "new" }

        state.start()

        assertFalse(state.modified())
    }

    @Test
    fun `new edits during pending save are modified`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        state.start()

        state.update { "other" }

        assertTrue(state.modified())
    }

    @Test
    fun `matching external base accepts pending target`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        state.start()

        state.accept("new")

        assertFalse(state.modified())
    }

    @Test
    fun `stale external base is ignored while pending`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        state.start()

        state.accept("old")

        assertFalse(state.modified())
        assertEquals("old", state.baseline)
    }

    @Test
    fun `successful save accepts matching returned base`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        val token = state.start()!!

        state.complete(token, "new")

        assertEquals("new", state.baseline)
        assertEquals("new", state.draft)
        assertFalse(state.modified())
    }

    @Test
    fun `successful save falls back to applied target for stale returned base`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        val token = state.start()!!

        state.complete(token, "old")

        assertEquals("new", state.baseline)
        assertEquals("new", state.draft)
        assertFalse(state.modified())
    }

    @Test
    fun `stale external base after fallback completion does not revert applied target`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        val token = state.start()!!
        state.complete(token, "old")

        state.accept("old")

        assertEquals("new", state.baseline)
        assertEquals("new", state.draft)
        assertFalse(state.modified())
    }

    @Test
    fun `stale external base after fresh completion does not revert applied target`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        val token = state.start()!!
        state.complete(token, "new")

        state.accept("old")

        assertEquals("new", state.baseline)
        assertEquals("new", state.draft)
        assertFalse(state.modified())
    }

    @Test
    fun `fresh external base after ignored stale update is accepted`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        val token = state.start()!!
        state.complete(token, "old")
        state.accept("old")

        state.accept("other")

        assertEquals("other", state.baseline)
        assertEquals("other", state.draft)
        assertFalse(state.modified())
    }

    @Test
    fun `older stale external base after multiple saves is ignored`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        val first = state.start()!!
        state.complete(first, "new")
        state.update { "other" }
        val second = state.start()!!
        state.complete(second, "other")

        state.accept("old")

        assertEquals("other", state.baseline)
        assertEquals("other", state.draft)
        assertFalse(state.modified())
    }

    @Test
    fun `failed save keeps draft dirty and restores previous base`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        val token = state.start()!!

        state.fail(token, "failed")

        assertEquals("old", state.baseline)
        assertEquals("new", state.draft)
        assertEquals("failed", state.error)
        assertTrue(state.modified())
    }

    @Test
    fun `concurrent edit is preserved after save completion`() {
        val state = SettingsDraftState("old")
        state.update { "new" }
        val token = state.start()!!
        state.update { "other" }

        state.complete(token, "new")

        assertEquals("new", state.baseline)
        assertEquals("other", state.draft)
        assertTrue(state.modified())
    }
}
