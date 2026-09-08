package ai.kilocode.client.ui.diagram.mermaid

internal data class Tok(val text: String, val at: Int)

/** Small lexing helpers shared by the chart parsers. */
internal object Lex {
    /** Splits on commas that sit outside quotes and outside bracket groups; parts are trimmed. */
    fun args(text: String): List<String> {
        val mask = Source.opens(text)
        val out = mutableListOf<String>()
        var start = 0
        for (idx in text.indices) {
            if (text[idx] != ',' || !mask[idx]) continue
            out.add(text.substring(start, idx).trim())
            start = idx + 1
        }
        out.add(text.substring(start).trim())
        return out
    }

    /** The body inside the outermost `(...)` of a call-shaped statement, or null when malformed. */
    fun call(text: String): String? {
        val open = text.indexOf('(')
        if (open < 0 || !text.trimEnd().endsWith(")")) return null
        return text.substring(open + 1, text.trimEnd().length - 1)
    }

    fun num(text: String): Double? = text.trim().toDoubleOrNull()

    /** Whitespace tokens with their offsets; quoted strings and bracket groups stay glued. */
    fun tokens(text: String): List<Tok> {
        val mask = Source.opens(text)
        val out = mutableListOf<Tok>()
        var start = -1
        for (idx in text.indices) {
            if (text[idx].isWhitespace() && mask[idx]) {
                if (start >= 0) {
                    out.add(Tok(text.substring(start, idx), start))
                    start = -1
                }
                continue
            }
            if (start < 0) start = idx
        }
        if (start >= 0) out.add(Tok(text.substring(start), start))
        return out
    }

    /** `id["Label"]` → id to label; a bare token maps to itself. */
    fun tagged(text: String): Pair<String, String>? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        val open = trimmed.indexOf('[')
        if (open < 0) return trimmed to trimmed
        if (!trimmed.endsWith("]") || open == 0) return null
        val id = trimmed.substring(0, open).trim()
        val label = Source.unquote(trimmed.substring(open + 1, trimmed.length - 1).trim())
        return id to label
    }
}
