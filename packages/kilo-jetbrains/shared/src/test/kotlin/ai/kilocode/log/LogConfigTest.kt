package ai.kilocode.log

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class LogConfigTest {

    @AfterTest
    fun tearDown() {
        System.clearProperty(LogConfig.LEVEL_PROPERTY)
        System.clearProperty(LogConfig.CONTENT_PROPERTY)
        System.clearProperty(LogConfig.PREVIEW_PROPERTY)
        LogConfig.apply(null, null, null)
    }

    @Test
    fun `defaults match current defaults`() {
        LogConfig.apply(null, null, null)

        assertEquals(LogConfig.LogLevel.INFO, LogConfig.level())
        assertEquals(LogConfig.ContentMode.OFF, LogConfig.contentMode())
        assertEquals(LogConfig.DEFAULT_PREVIEW, LogConfig.previewMax())
    }

    @Test
    fun `property seeds value when no user value`() {
        System.setProperty(LogConfig.LEVEL_PROPERTY, "debug")
        System.setProperty(LogConfig.CONTENT_PROPERTY, "full")
        System.setProperty(LogConfig.PREVIEW_PROPERTY, "42")
        LogConfig.apply(null, null, null)

        assertEquals(LogConfig.LogLevel.DEBUG, LogConfig.level())
        assertEquals(LogConfig.ContentMode.FULL, LogConfig.contentMode())
        assertEquals(42, LogConfig.previewMax())
    }

    @Test
    fun `user value wins over property`() {
        System.setProperty(LogConfig.LEVEL_PROPERTY, "debug")
        System.setProperty(LogConfig.CONTENT_PROPERTY, "full")

        LogConfig.apply("ERROR", "PREVIEW", 10)

        assertEquals(LogConfig.LogLevel.ERROR, LogConfig.level())
        assertEquals(LogConfig.ContentMode.PREVIEW, LogConfig.contentMode())
        assertEquals(10, LogConfig.previewMax())
    }

    @Test
    fun `null user value falls back to property then default`() {
        System.setProperty(LogConfig.LEVEL_PROPERTY, "warn")
        LogConfig.apply(null, null, null)

        assertEquals(LogConfig.LogLevel.WARN, LogConfig.level())
        assertEquals(LogConfig.ContentMode.OFF, LogConfig.contentMode())
        assertEquals(LogConfig.DEFAULT_PREVIEW, LogConfig.previewMax())
    }

    @Test
    fun `preview max is clamped`() {
        LogConfig.apply(null, null, 999999)
        assertEquals(LogConfig.MAX_PREVIEW, LogConfig.previewMax())

        LogConfig.apply(null, null, 0)
        assertEquals(LogConfig.MIN_PREVIEW, LogConfig.previewMax())
    }
}
