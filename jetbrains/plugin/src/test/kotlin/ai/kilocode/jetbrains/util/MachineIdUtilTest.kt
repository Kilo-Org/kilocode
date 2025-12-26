package ai.kilocode.jetbrains.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MachineIdUtilTest {

    @Before
    fun setUp() {
        // Clear the cache before each test to ensure fresh generation
        MachineIdUtil.clearCache()
    }

    @Test
    fun `test getMachineId returns non-null value`() {
        val machineId = MachineIdUtil.getMachineId()
        assertNotNull("Machine ID should not be null", machineId)
    }

    @Test
    fun `test getMachineId returns non-empty value`() {
        val machineId = MachineIdUtil.getMachineId()
        assertTrue("Machine ID should not be empty", machineId.isNotEmpty())
    }

    @Test
    fun `test getMachineId returns SHA-256 hash format`() {
        val machineId = MachineIdUtil.getMachineId()
        // SHA-256 produces a 64-character hex string
        assertEquals("Machine ID should be 64 characters (SHA-256 hex)", 64, machineId.length)
        // Should only contain hex characters
        assertTrue(
            "Machine ID should only contain hex characters",
            machineId.all { it in '0'..'9' || it in 'a'..'f' }
        )
    }

    @Test
    fun `test getMachineId returns consistent value`() {
        val machineId1 = MachineIdUtil.getMachineId()
        val machineId2 = MachineIdUtil.getMachineId()
        assertEquals("Machine ID should be consistent across calls", machineId1, machineId2)
    }

    @Test
    fun `test getMachineId caching works`() {
        // First call generates the ID
        val machineId1 = MachineIdUtil.getMachineId()

        // Second call should return cached value
        val machineId2 = MachineIdUtil.getMachineId()

        assertEquals("Cached machine ID should match original", machineId1, machineId2)
    }

    @Test
    fun `test clearCache allows regeneration`() {
        // Get initial machine ID
        val machineId1 = MachineIdUtil.getMachineId()

        // Clear cache
        MachineIdUtil.clearCache()

        // Get machine ID again - should regenerate (but will be same value since same machine)
        val machineId2 = MachineIdUtil.getMachineId()

        // On the same machine, the regenerated ID should be the same
        assertEquals("Regenerated machine ID should match on same machine", machineId1, machineId2)
    }

    @Test
    fun `test getMachineId does not contain intellij-machine placeholder`() {
        val machineId = MachineIdUtil.getMachineId()
        assertNotEquals(
            "Machine ID should not be the old placeholder value",
            "intellij-machine",
            machineId
        )
    }

    @Test
    fun `test getMachineId is lowercase hex`() {
        val machineId = MachineIdUtil.getMachineId()
        assertEquals(
            "Machine ID should be lowercase",
            machineId.lowercase(),
            machineId
        )
    }
}
