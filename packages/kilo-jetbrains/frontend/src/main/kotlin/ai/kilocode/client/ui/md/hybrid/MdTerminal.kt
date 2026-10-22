package ai.kilocode.client.ui.md.hybrid

import com.intellij.execution.process.AnsiEscapeDecoder
import com.intellij.execution.process.ProcessOutputTypes
import com.intellij.openapi.util.Key

internal data class Range(val start: Int, val end: Int, val key: Key<*>)

internal data class Term(val text: String, val ranges: List<Range>)

internal object MdTerminal {
    private val ansi = Regex("\\u001B\\[[0-?]*[ -/]*[@-~]")

    fun decode(text: String, stream: Stream): Term {
        val out = StringBuilder()
        val ranges = mutableListOf<Range>()
        val key = when (stream) {
            Stream.Stdout -> ProcessOutputTypes.STDOUT
            Stream.Stderr -> ProcessOutputTypes.STDERR
        }
        // AnsiEscapeDecoder handles SGR coloring; full terminal emulation is too heavy for inline transcripts.
        AnsiEscapeDecoder().escapeText(reduce(text, keepSgr = true), key) { chunk, attrs ->
            val start = out.length
            out.append(chunk)
            val end = out.length
            if (start != end) ranges.add(Range(start, end, attrs))
        }
        return Term(out.toString().trimEnd('\n'), ranges)
    }

    fun split(text: String, delim: Char): List<String> {
        val list = mutableListOf<String>()
        var start = 0
        while (true) {
            val index = text.indexOf(delim, start)
            if (index < 0) {
                list.add(text.substring(start))
                return list
            }
            list.add(text.substring(start, index))
            start = index + 1
        }
    }

    fun reduce(text: String, keepSgr: Boolean): String = split(text.replace("\r\n", "\n"), '\n')
        .joinToString("\n") { controls(it, keepSgr) }

    fun strip(text: String): String = ansi.replace(text, "")

    fun hasAnsi(text: String): Boolean = ansi.containsMatchIn(text)

    private fun controls(text: String, keepSgr: Boolean): String {
        val out = StringBuilder()
        val src = text
        var idx = 0
        fun esc(): String? {
            if (src[idx] != '\u001B') return null
            if (idx + 1 >= src.length || src[idx + 1] != '[') {
                idx++
                return ""
            }
            var end = idx + 2
            while (end < src.length && src[end] !in '@'..'~') end++
            if (end >= src.length) {
                idx = src.length
                return ""
            }
            val seq = src.substring(idx, end + 1)
            idx = end + 1
            return if (keepSgr && seq.endsWith('m')) seq else ""
        }
        while (idx < src.length) {
            val seq = esc()
            if (seq != null) {
                out.append(seq)
                continue
            }
            when (val ch = src[idx++]) {
                '\r' -> out.clear()
                '\b' -> if (out.isNotEmpty()) out.deleteCharAt(out.length - 1)
                '\t' -> out.append(ch)
                else -> if (!ch.isISOControl()) out.append(ch)
            }
        }
        return out.toString()
    }
}
