package ai.kilocode.client.ui.diagram.mermaid

/** One preprocessed line plus the 1-based line number it came from in the user's text. */
internal data class Line(val text: String, val at: Int)

internal data class Clean(val lines: List<Line>)

/**
 * Mermaid source preprocessing.
 *
 * Normalizes line endings and tabs, drops leading YAML frontmatter, blanks `%%{ ... }%%` init
 * directives without shifting line numbers, and cuts `%%` comments outside quoted strings. Every
 * surviving line keeps its original line number so parse failures can point at the user's text.
 */
internal object Source {
    private const val RAILS = "-.="
    private const val OPEN = "%%{"
    private const val CLOSE = "}%%"

    fun clean(text: String): Clean {
        val raw = mask(normalize(text)).split("\n")
        val start = front(raw)
        val out = ArrayList<Line>(raw.size - start)
        for (idx in start until raw.size) out.add(Line(cut(raw[idx]), idx + 1))
        return Clean(out)
    }

    /** Splits label text on the break forms mermaid accepts. */
    fun label(text: String): List<String> {
        val body = unquote(text.trim())
        val parts = body.split("<br/>", "<br>", "<br />", "\\n", "\n").map { it.trim() }
        val kept = parts.filter { it.isNotEmpty() }
        if (kept.isEmpty()) return listOf("")
        return kept
    }

    fun unquote(text: String): String {
        if (text.length < 2) return text
        if (text.first() == '"' && text.last() == '"') return text.substring(1, text.length - 1)
        return text
    }

    /**
     * Per-index "sits outside quotes and outside any bracket group" flags for one line.
     *
     * Computed in a single pass and reused by every scanner on that line. Answering the question per
     * index instead (rescanning from 0 each time) is quadratic, which a 100k character line turns into
     * seconds of uninterruptible work because cancellation is only checked between lines.
     */
    fun opens(text: String): BooleanArray {
        val out = BooleanArray(text.length)
        var quote = false
        var depth = 0
        for (idx in text.indices) {
            out[idx] = !quote && depth <= 0
            val char = text[idx]
            if (char == '"') {
                quote = !quote
                continue
            }
            if (quote) continue
            if (char == '[' || char == '(' || char == '{') depth++
            if (char == ']' || char == ')' || char == '}') depth--
        }
        return out
    }

    fun rail(char: Char) = RAILS.indexOf(char) >= 0

    private fun normalize(text: String) = text
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\t", "    ")

    /**
     * Blanks `%%{ ... }%%` directives in place. Scanned by hand rather than with a lazy regex
     * because `%%\{[\s\S]*?}%%` rescans to the end of the text for every unterminated `%%{`, which
     * is quadratic on pathological input.
     */
    private fun mask(text: String): String {
        if (!text.contains(OPEN)) return text
        val out = StringBuilder(text)
        var idx = 0
        while (idx < out.length) {
            val open = out.indexOf(OPEN, idx)
            if (open < 0) return out.toString()
            val close = out.indexOf(CLOSE, open + OPEN.length)
            if (close < 0) return out.toString()
            for (at in open until close + CLOSE.length) {
                if (out[at] != '\n') out[at] = ' '
            }
            idx = close + CLOSE.length
        }
        return out.toString()
    }

    /** Returns the index of the first content line, skipping terminated frontmatter. */
    private fun front(raw: List<String>): Int {
        var idx = 0
        while (idx < raw.size && raw[idx].isBlank()) idx++
        if (idx >= raw.size || raw[idx].trim() != "---") return 0
        var scan = idx + 1
        while (scan < raw.size) {
            if (raw[scan].trim() == "---") return scan + 1
            scan++
        }
        return 0
    }

    private fun cut(line: String): String {
        var quote = false
        var idx = 0
        while (idx < line.length) {
            val char = line[idx]
            if (char == '"') quote = !quote
            if (!quote && char == '%' && idx + 1 < line.length && line[idx + 1] == '%') {
                return line.substring(0, idx).trimEnd()
            }
            idx++
        }
        return line
    }
}
