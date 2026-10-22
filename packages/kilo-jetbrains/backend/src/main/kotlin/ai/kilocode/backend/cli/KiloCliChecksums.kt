package ai.kilocode.backend.cli

import java.util.Properties

object KiloCliChecksums {
    private const val RESOURCE = "kilo-cli-checksums.properties"

    private val values by lazy {
        val stream = KiloCliChecksums::class.java.classLoader.getResourceAsStream(RESOURCE)
            ?: return@lazy emptyMap()
        stream.use {
            Properties().apply { load(it) }
                .entries
                .associate { item -> item.key.toString() to item.value.toString() }
        }
    }

    fun load(): Map<String, String> = values
}
