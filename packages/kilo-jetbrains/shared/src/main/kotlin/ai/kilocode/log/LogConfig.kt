package ai.kilocode.log

import java.util.logging.Level

object LogConfig {
    const val MIN_PREVIEW = 1
    const val MAX_PREVIEW = 2000
    const val DEFAULT_PREVIEW = 160
    const val LEVEL_PROPERTY = "kilo.dev.log.level"
    const val CONTENT_PROPERTY = "kilo.dev.log.chat.content"
    const val PREVIEW_PROPERTY = "kilo.dev.log.chat.preview.max"

    class LogLevel(val value: String, val jul: Level) {
        override fun toString(): String = value

        companion object {
            @JvmField val DEBUG = LogLevel("DEBUG", Level.FINE)
            @JvmField val INFO = LogLevel("INFO", Level.INFO)
            @JvmField val WARN = LogLevel("WARN", Level.WARNING)
            @JvmField val ERROR = LogLevel("ERROR", Level.SEVERE)
            @JvmField val OFF = LogLevel("OFF", Level.OFF)
            @JvmField val all = listOf(DEBUG, INFO, WARN, ERROR, OFF)
        }
    }

    class ContentMode(val value: String) {
        override fun toString(): String = value

        companion object {
            @JvmField val OFF = ContentMode("OFF")
            @JvmField val PREVIEW = ContentMode("PREVIEW")
            @JvmField val FULL = ContentMode("FULL")
            @JvmField val all = listOf(OFF, PREVIEW, FULL)
        }
    }

    // User overrides win over JVM properties, which in turn seed the default.
    @Volatile
    private var userLevel: LogLevel? = null
    @Volatile
    private var userContent: ContentMode? = null
    @Volatile
    private var userPreview: Int? = null

    fun level(): LogLevel = userLevel ?: propertyLevel() ?: LogLevel.INFO
    fun contentMode(): ContentMode = userContent ?: propertyContentMode() ?: ContentMode.OFF
    fun previewMax(): Int = userPreview ?: propertyPreviewMax() ?: DEFAULT_PREVIEW
    fun julLevel(): Level = level().jul

    /**
     * Apply user-managed overrides. A `null` argument clears that override so the value
     * falls back to the JVM property (if set) and then the hardcoded default.
     */
    fun apply(
        level: String?,
        contentMode: String?,
        previewMax: Int?,
    ) {
        userLevel = parseLevel(level)
        userContent = parseContentMode(contentMode)
        userPreview = previewMax?.let(::clamp)
        FileLog.refreshLevel()
    }

    fun parseLevel(value: String?): LogLevel? = when (value?.uppercase()) {
        "DEBUG" -> LogLevel.DEBUG
        "INFO" -> LogLevel.INFO
        "WARN", "WARNING" -> LogLevel.WARN
        "ERROR" -> LogLevel.ERROR
        "OFF" -> LogLevel.OFF
        else -> null
    }

    fun parseContentMode(value: String?): ContentMode? = when (value?.uppercase()) {
        "OFF" -> ContentMode.OFF
        "PREVIEW" -> ContentMode.PREVIEW
        "FULL" -> ContentMode.FULL
        else -> null
    }

    private fun propertyLevel(): LogLevel? = parseLevel(System.getProperty(LEVEL_PROPERTY))
    private fun propertyContentMode(): ContentMode? = parseContentMode(System.getProperty(CONTENT_PROPERTY))
    private fun propertyPreviewMax(): Int? = System.getProperty(PREVIEW_PROPERTY)?.toIntOrNull()?.let(::clamp)
    private fun clamp(value: Int): Int = value.coerceIn(MIN_PREVIEW, MAX_PREVIEW)
}
