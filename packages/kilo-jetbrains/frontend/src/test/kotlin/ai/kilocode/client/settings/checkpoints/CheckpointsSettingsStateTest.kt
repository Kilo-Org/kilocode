package ai.kilocode.client.settings.checkpoints

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.RetentionConfigDto
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CheckpointsSettingsStateTest {
    @Test
    fun `draft defaults snapshots to on when the key is unset`() {
        assertTrue(checkpointsDraft(null).snapshot)
        assertTrue(checkpointsDraft(ConfigDto()).snapshot)
    }

    @Test
    fun `draft reads explicit snapshot values`() {
        assertFalse(checkpointsDraft(ConfigDto(snapshot = false)).snapshot)
        assertTrue(checkpointsDraft(ConfigDto(snapshot = true)).snapshot)
    }

    @Test
    fun `unchanged draft emits no patch`() {
        assertNull(patch(CheckpointsDraft(snapshot = true), CheckpointsDraft(snapshot = true)))
        assertNull(patch(CheckpointsDraft(snapshot = false), CheckpointsDraft(snapshot = false)))
    }

    @Test
    fun `snapshot changes emit explicit booleans`() {
        assertEquals(false, patch(CheckpointsDraft(snapshot = true), CheckpointsDraft(snapshot = false))?.snapshot)
        assertEquals(true, patch(CheckpointsDraft(snapshot = false), CheckpointsDraft(snapshot = true))?.snapshot)
    }

    @Test
    fun `retention defaults disabled at thirty days and reads only global config`() {
        assertEquals(CheckpointsDraft(), checkpointsDraft(ConfigDto()))
        assertEquals(
            CheckpointsDraft(snapshot = false, cleanup = true, days = 45),
            checkpointsDraft(
                ConfigDto(snapshot = false, retention = RetentionConfigDto(enabled = false, maxAgeDays = 7)),
                ConfigDto(retention = RetentionConfigDto(enabled = true, maxAgeDays = 45)),
            ),
        )
    }

    @Test
    fun `retention changes emit a complete global policy`() {
        val change = patch(CheckpointsDraft(), CheckpointsDraft(cleanup = true, days = 60))

        assertEquals(true, change?.retention?.enabled)
        assertEquals(60, change?.retention?.maxAgeDays)
        assertNull(change?.snapshot)
    }

    @Test
    fun `savedMatches compares snapshot state`() {
        assertTrue(savedMatches(CheckpointsDraft(snapshot = true), CheckpointsDraft(snapshot = true)))
        assertFalse(savedMatches(CheckpointsDraft(snapshot = true), CheckpointsDraft(snapshot = false)))
    }
}
