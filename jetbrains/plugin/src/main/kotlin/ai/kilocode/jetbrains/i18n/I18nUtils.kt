package ai.kilocode.jetbrains.i18n

/**
 * Convenience function for translations using I18n with named parameters
 * @param key Translation key using namespace:path format (e.g., "jetbrains:errors.nodejsMissing.title")
 * @param params Named parameters for interpolation (e.g., mapOf("minVersion" to "18.0.0"))
 * @return Translated string
 */
fun t(key: String, params: Map<String, Any> = emptyMap()): String {
    return I18n.t(key, params)
}

/**
 * Convenience function with vararg parameters
 */
fun t(key: String, vararg params: Pair<String, Any>): String {
    return I18n.t(key, *params)
}
