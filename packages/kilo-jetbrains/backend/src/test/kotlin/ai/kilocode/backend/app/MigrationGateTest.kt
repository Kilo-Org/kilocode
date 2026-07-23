package ai.kilocode.backend.app

import ai.kilocode.backend.migration.LegacyMigrationStatus
import kotlin.test.Test
import kotlin.test.assertEquals

class MigrationGateTest {

    @Test
    fun `proceeds when nothing is decided`() {
        assertEquals(MigrationGate.Proceed, migrationGate(suppressed = false, offered = false, status = null))
    }

    @Test
    fun `suppressed blocks the offer`() {
        assertEquals(MigrationGate.Suppressed, migrationGate(suppressed = true, offered = false, status = null))
    }

    @Test
    fun `already offered blocks a second offer this startup`() {
        assertEquals(MigrationGate.AlreadyOffered, migrationGate(suppressed = false, offered = true, status = null))
    }

    @Test
    fun `persisted status blocks the offer`() {
        assertEquals(
            MigrationGate.StatusSet,
            migrationGate(suppressed = false, offered = false, status = LegacyMigrationStatus.Completed),
        )
    }

    @Test
    fun `suppression takes priority over offered and status`() {
        assertEquals(
            MigrationGate.Suppressed,
            migrationGate(suppressed = true, offered = true, status = LegacyMigrationStatus.Skipped),
        )
    }
}
