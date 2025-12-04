package ai.kilocode.jetbrains.i18n

import com.intellij.DynamicBundle
import com.intellij.openapi.diagnostic.Logger

/**
 * Dynamic translation system for Kilo Code JetBrains plugin
 *
 * Supports named parameter substitution and auto-discovery of translation bundles.
 * Maintains API compatibility with the TypeScript i18n system.
 */
object I18n {
    private val logger = Logger.getInstance(I18n::class.java)
    private val bundleCache = mutableMapOf<String, DynamicBundle>()

    /**
     * Main translation function with named parameter support
     * @param fullKey Translation key in "namespace:key.path" format (e.g., "jetbrains:errors.nodejsMissing.title")
     * @param params Named parameters as map for substitution (e.g., mapOf("minVersion" to "18.0.0"))
     * @return Translated string with parameters substituted
     */
    @JvmStatic
    fun t(fullKey: String, params: Map<String, Any> = emptyMap()): String {
        val parts = fullKey.split(":", limit = 2)
        if (parts.size != 2) {
            logger.warn("Invalid translation key format: $fullKey (expected 'namespace:key')")
            return fullKey
        }

        val namespace = parts[0]
        val key = parts[1]

        return try {
            val bundle = getOrCreateBundle(namespace)
            val template = bundle.getMessage(key)
            substituteNamedParams(template, params)
        } catch (e: Exception) {
            logger.warn("Translation failed for key: $fullKey", e)
            fullKey // Fallback to key name
        }
    }

    /**
     * Convenience method for vararg parameters (matches TypeScript pattern)
     */
    @JvmStatic
    fun t(fullKey: String, vararg params: Pair<String, Any>): String {
        return t(fullKey, params.toMap())
    }

    /**
     * Get or create bundle dynamically based on namespace
     */
    private fun getOrCreateBundle(namespace: String): DynamicBundle {
        return bundleCache.getOrPut(namespace) {
            val bundleName = "messages.${namespace.replaceFirstChar { it.uppercase() }}Bundle"
            try {
                object : DynamicBundle(bundleName) {}
            } catch (e: Exception) {
                logger.error("Failed to create bundle for namespace: $namespace", e)
                throw e
            }
        }
    }

    /**
     * Substitute named parameters in template string
     * Supports {{paramName}} placeholders with named parameter map
     */
    private fun substituteNamedParams(template: String, params: Map<String, Any>): String {
        if (params.isEmpty()) return template

        var result = template
        val placeholderPattern = """\{\{(\w+)\}\}""".toRegex()

        placeholderPattern.findAll(template).forEach { match ->
            val paramName = match.groupValues[1]
            val paramValue = params[paramName]?.toString()
            if (paramValue != null) {
                result = result.replace(match.value, paramValue)
            } else {
                logger.warn("Parameter not provided: $paramName in template: $template")
            }
        }

        return result
    }
}
