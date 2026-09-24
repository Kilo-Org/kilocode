package ai.kilocode.client.settings.checkpoints

import ai.kilocode.rpc.dto.ConfigDto
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CheckpointsSettingsStateTest {
    @Test
    fun `draft defaults snapshots to on when the key is unset`() {
        assertTrue(checkpointsDraft(null).enabled)
        assertTrue(checkpointsDraft(ConfigDto()).enabled)
    }

    @Test
    fun `draft reads explicit snapshot values`() {
        assertFalse(checkpointsDraft(ConfigDto(snapshot = false)).enabled)
        assertTrue(checkpointsDraft(ConfigDto(snapshot = true)).enabled)
    }

    @Test
    fun `unchanged draft emits no patch`() {
        assertNull(patch(CheckpointsDraft(enabled = true), CheckpointsDraft(enabled = true)))
        assertNull(patch(CheckpointsDraft(enabled = false), CheckpointsDraft(enabled = false)))
    }

    @Test
    fun `snapshot changes emit explicit booleans`() {
        assertEquals(false, patch(CheckpointsDraft(enabled = true), CheckpointsDraft(enabled = false))?.snapshot)
        assertEquals(true, patch(CheckpointsDraft(enabled = false), CheckpointsDraft(enabled = true))?.snapshot)
    }

    @Test
    fun `savedMatches compares snapshot state`() {
        assertTrue(savedMatches(CheckpointsDraft(enabled = true), CheckpointsDraft(enabled = true)))
        assertFalse(savedMatches(CheckpointsDraft(enabled = true), CheckpointsDraft(enabled = false)))
    }
}
