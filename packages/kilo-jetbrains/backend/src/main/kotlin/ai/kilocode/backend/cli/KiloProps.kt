package ai.kilocode.backend.cli

import java.util.Properties

object KiloProps {
    private val props by lazy {
        val stream = KiloProps::class.java.classLoader.getResourceAsStream("kilo.properties")
            ?: throw IllegalStateException("kilo.properties resource not found")
        stream.use {
            Properties().apply { load(it) }
        }
    }

    fun cliVersion(): String = props.getProperty("cli.version")
        ?: throw IllegalStateException("cli.version missing from kilo.properties")
}
