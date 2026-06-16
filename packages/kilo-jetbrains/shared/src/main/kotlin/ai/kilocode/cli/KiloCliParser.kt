package ai.kilocode.cli

import java.util.concurrent.ConcurrentHashMap

object KiloCliParser {
    private val tags = ConcurrentHashMap<String, Regex>()

    fun tag(text: String, name: String): String? =
        tags.computeIfAbsent(name) {
            val tag = Regex.escape(it)
            Regex("<$tag>\\s*([\\s\\S]*?)\\s*</$tag>")
        }
            .find(text)
            ?.groupValues
            ?.getOrNull(1)
            ?.trim()
            ?.takeIf { it.isNotBlank() }
}
