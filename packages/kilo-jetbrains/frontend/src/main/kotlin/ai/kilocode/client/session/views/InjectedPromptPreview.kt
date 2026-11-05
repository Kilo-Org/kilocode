package ai.kilocode.client.session.views

/** Number of lines above which an injected prompt collapses to its first paragraph. */
internal const val INJECTED_COLLAPSE_LINES = 4

/** First paragraph shown while an injected prompt is collapsed, or null when the text is short. */
internal fun injectedPreview(text: String): String? {
    val body = text.trim()
    if (body.split("\n").size <= INJECTED_COLLAPSE_LINES) return null
    val first = body.split(Regex("\\n\\s*\\n"), limit = 2).firstOrNull()?.trim()
    return first?.takeIf { it.isNotEmpty() && it != body }
}
