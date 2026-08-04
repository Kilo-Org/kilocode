package ai.kilocode.client.plugin

import com.intellij.DynamicBundle
import org.jetbrains.annotations.PropertyKey

private const val BUNDLE = "messages.KiloBundle"

object KiloBundle : DynamicBundle(BUNDLE) {
    fun message(@PropertyKey(resourceBundle = BUNDLE) key: String, vararg params: Any): String {
        return getMessage(key, *params)
    }

    fun optional(key: String, vararg params: Any): String? {
        if (!containsKey(key)) return null
        return getMessage(key, *params)
    }
}
