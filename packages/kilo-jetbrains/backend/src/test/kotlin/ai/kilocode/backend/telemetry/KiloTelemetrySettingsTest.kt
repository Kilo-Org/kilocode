package ai.kilocode.backend.telemetry

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KiloTelemetrySettingsTest {
    @AfterTest
    fun tearDown() {
        KiloTelemetrySettings.set(true)
    }

    @Test
    fun `setting is on by default`() {
        assertTrue(KiloTelemetrySettings.get())
    }

    @Test
    fun `enabled setting does not force a level`() {
        assertNull(KiloTelemetrySettings.level(dev = false))
    }

    @Test
    fun `disabled setting forces the level off`() {
        KiloTelemetrySettings.set(false)

        assertEquals("off", KiloTelemetrySettings.level(dev = false))
    }

    @Test
    fun `dev mode forces the level off`() {
        assertEquals("off", KiloTelemetrySettings.level(dev = true))
    }

    @Test
    fun `CLI allows telemetry without any opt-out`() {
        assertTrue(KiloTelemetrySettings.allowed(emptyMap(), null))
        assertTrue(KiloTelemetrySettings.allowed(emptyMap(), true))
    }

    @Test
    fun `global config opt-out is honored`() {
        assertFalse(KiloTelemetrySettings.allowed(emptyMap(), false))
    }

    @Test
    fun `inherited level other than all is an opt-out`() {
        assertFalse(KiloTelemetrySettings.allowed(mapOf("KILO_TELEMETRY_LEVEL" to "off"), null))
        assertFalse(KiloTelemetrySettings.allowed(mapOf("KILO_TELEMETRY_LEVEL" to "error"), true))
    }

    @Test
    fun `inherited level decides before the global config, as in the CLI`() {
        assertTrue(KiloTelemetrySettings.allowed(mapOf("KILO_TELEMETRY_LEVEL" to "all"), false))
    }

    @Test
    fun `empty inherited level falls back to the global config`() {
        assertTrue(KiloTelemetrySettings.allowed(mapOf("KILO_TELEMETRY_LEVEL" to ""), null))
        assertFalse(KiloTelemetrySettings.allowed(mapOf("KILO_TELEMETRY_LEVEL" to ""), false))
    }
}
