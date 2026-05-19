package ai.kilocode.client.plugin

import com.intellij.DynamicBundle
import org.jetbrains.annotations.PropertyKey

private const val BUNDLE = "messages.KiloBundle"

object KiloBundle : DynamicBundle(BUNDLE) {
    fun message(@PropertyKey(resourceBundle = BUNDLE) key: String, vararg params: Any): String {
        return getMessage(key, *params)
    }

    fun dynamic(key: String?, fallback: String): String {
        val value = key?.takeIf { it.isNotBlank() } ?: return fallback
        return runCatching { getMessage(value) }.getOrDefault(fallback)
    }
}
