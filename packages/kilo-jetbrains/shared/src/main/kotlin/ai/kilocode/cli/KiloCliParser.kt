package ai.kilocode.cli

import java.util.concurrent.ConcurrentHashMap

object KiloCliParser {
    const val MODE_PRIMARY = "primary"
    const val MODE_SUBAGENT = "subagent"
    const val MODE_ALL = "all"
    const val CONFIG_DEFAULT_AGENT = "default_agent"

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

    fun isSubagent(mode: String?) = mode == MODE_SUBAGENT

    fun defaultAgentCandidate(mode: String?, hidden: Boolean?) = !isSubagent(mode) && hidden != true
}
