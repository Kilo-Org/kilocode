package ai.kilocode.backend.telemetry

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloTelemetryPolicyTest {
    @Test
    fun `no level is forced outside dev mode`() {
        assertNull(KiloTelemetryPolicy.level(dev = false))
    }

    @Test
    fun `dev mode forces the level off`() {
        assertEquals("off", KiloTelemetryPolicy.level(dev = true))
    }

    @Test
    fun `telemetry is on without any opt-out`() {
        assertTrue(KiloTelemetryPolicy.enabled(emptyMap(), null))
        assertTrue(KiloTelemetryPolicy.enabled(emptyMap(), true))
    }

    @Test
    fun `global config opt-out is honored`() {
        assertFalse(KiloTelemetryPolicy.enabled(emptyMap(), false))
    }

    @Test
    fun `inherited level other than all is an opt-out`() {
        assertEquals(false, KiloTelemetryPolicy.override(mapOf("KILO_TELEMETRY_LEVEL" to "off")))
        assertFalse(KiloTelemetryPolicy.enabled(mapOf("KILO_TELEMETRY_LEVEL" to "error"), true))
    }

    @Test
    fun `inherited level decides before the global config, as in the CLI`() {
        assertEquals(true, KiloTelemetryPolicy.override(mapOf("KILO_TELEMETRY_LEVEL" to "all")))
        assertTrue(KiloTelemetryPolicy.enabled(mapOf("KILO_TELEMETRY_LEVEL" to "all"), false))
    }

    @Test
    fun `unset or empty inherited level leaves the decision to the global config`() {
        assertNull(KiloTelemetryPolicy.override(emptyMap()))
        assertNull(KiloTelemetryPolicy.override(mapOf("KILO_TELEMETRY_LEVEL" to "")))
        assertFalse(KiloTelemetryPolicy.enabled(mapOf("KILO_TELEMETRY_LEVEL" to ""), false))
    }
}
