package ai.kilocode.client.ui.md.hybrid

import com.intellij.openapi.fileTypes.PlainTextFileType
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.node.AbstractVisitor
import org.commonmark.node.Block
import org.commonmark.node.Document
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Node
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser
import org.commonmark.renderer.html.HtmlRenderer

internal class MdProjector {
    private val extensions = listOf(
        AutolinkExtension.create(),
        TablesExtension.create(),
        StrikethroughExtension.create(),
    )

    private val parser: Parser = Parser.builder().extensions(extensions).build()

    private val renderer: HtmlRenderer = HtmlRenderer.builder()
        .extensions(extensions)
        .escapeHtml(true)
        .sanitizeUrls(true)
        .build()

    fun project(text: String): Projection {
        val blocks = mutableListOf<Desc>()
        val html = StringBuilder()
        val md = StringBuilder()
        val lines = lines(text)
        var trailing: Fence? = null
        var idx = 0

        fun flush() {
            if (md.isEmpty()) return
            val doc = parser.parse(md.toString())
            val descs = collect(doc)
            blocks.addAll(descs)
            for (desc in descs) {
                when (desc) {
                    is Desc.Html -> html.append(desc.body)
                    is Desc.Code -> html.append(codeHtml(desc.text))
                    is Desc.Table -> html.append(desc.body)
                }
            }
            md.clear()
        }

        while (idx < lines.size) {
            val line = lines[idx]
            val open = opener(line.text)
            if (open == null) {
                val pending = idx == lines.lastIndex && pendingOpener(line.text)
                if (pending) {
                    flush()
                    blocks.add(Desc.Code("", Kind.Source(PlainTextFileType.INSTANCE)))
                    html.append(codeHtml(""))
                } else {
                    md.append(line.text).append(line.end)
                }
                idx++
                continue
            }

            flush()
            idx++
            val code = StringBuilder()
            var closed = false
            var trimmed = false
            while (idx < lines.size) {
                val item = lines[idx]
                val close = closer(item.text, open)
                if (close) {
                    closed = true
                    idx++
                    break
                }
                val partial = idx == lines.lastIndex && partialCloser(item.text, open)
                if (partial) trimmed = true
                if (!partial) code.append(item.text).append(item.end)
                idx++
            }
            val desc = Desc.Code(code.toString(), MdLanguage.kind(open.info))
            blocks.add(desc)
            html.append(codeHtml(desc.text))
            trailing = if (!closed && !trimmed) open else null
        }

        flush()
        return Projection(html.toString(), blocks, trailing)
    }

    private fun collect(doc: Node): List<Desc> {
        val visitor = Visitor()
        doc.accept(visitor)
        return visitor.blocks
    }

    private fun lines(text: String): List<Line> {
        if (text.isEmpty()) return emptyList()
        val lines = mutableListOf<Line>()
        var start = 0
        while (start < text.length) {
            val end = text.indexOf('\n', start)
            if (end == -1) {
                lines.add(Line(text.substring(start), ""))
                break
            }
            lines.add(Line(text.substring(start, end), "\n"))
            start = end + 1
        }
        return lines
    }

    private fun opener(text: String): Fence? {
        val trimmed = text.dropWhile { it == ' ' }
        val indent = text.length - trimmed.length
        if (indent > 3) return null
        val char = trimmed.firstOrNull() ?: return null
        if (char != '`' && char != '~') return null
        val size = trimmed.takeWhile { it == char }.length
        if (size < 3) return null
        val info = trimmed.drop(size).trim()
        if (char == '`' && info.contains('`')) return null
        return Fence(char, size, info)
    }

    private fun closer(text: String, fence: Fence): Boolean {
        val trimmed = text.dropWhile { it == ' ' }
        val indent = text.length - trimmed.length
        if (indent > 3) return false
        val size = trimmed.takeWhile { it == fence.char }.length
        if (size < fence.size) return false
        return trimmed.drop(size).isBlank()
    }

    private fun pendingOpener(text: String): Boolean {
        val trimmed = text.dropWhile { it == ' ' }
        val indent = text.length - trimmed.length
        if (indent > 3) return false
        val char = trimmed.firstOrNull() ?: return false
        if (char != '`' && char != '~') return false
        val size = trimmed.takeWhile { it == char }.length
        if (size !in 1..2) return false
        return trimmed.drop(size).isBlank()
    }

    private fun partialCloser(text: String, fence: Fence): Boolean {
        val trimmed = text.dropWhile { it == ' ' }
        val indent = text.length - trimmed.length
        if (indent > 3) return false
        val size = trimmed.takeWhile { it == fence.char }.length
        if (size !in 1 until fence.size) return false
        return trimmed.drop(size).isBlank()
    }

    private fun codeHtml(text: String): String = "<pre><code>${escape(text)}</code></pre>\n"

    private fun escape(text: String): String = text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")

    private inner class Visitor : AbstractVisitor() {
        val blocks = mutableListOf<Desc>()
        private val run = StringBuilder()

        override fun visit(document: Document) {
            visitChildren(document)
            flush()
        }

        override fun visit(code: FencedCodeBlock) {
            flush()
            blocks.add(Desc.Code(code.literal, MdLanguage.kind(code.info)))
        }

        override fun visit(code: IndentedCodeBlock) {
            flush()
            blocks.add(Desc.Code(code.literal, MdLanguage.kind(null)))
        }

        private fun flush() {
            if (run.isEmpty()) return
            blocks.add(Desc.Html(run.toString()))
            run.clear()
        }

        public override fun visitChildren(parent: Node) {
            var child = parent.firstChild
            while (child != null) {
                val next = child.next
                when {
                    child is ThematicBreak -> Unit
                    child is FencedCodeBlock || child is IndentedCodeBlock -> child.accept(this)
                    child is TableBlock -> {
                        flush()
                        blocks.add(Desc.Table(renderer.render(child)))
                    }
                    child is Block -> run.append(renderer.render(child))
                }
                child = next
            }
        }
    }
}

internal sealed class Desc {
    data class Html(val body: String) : Desc()
    data class Code(val text: String, val kind: Kind) : Desc()
    data class Table(val body: String) : Desc()
}

internal data class Projection(val html: String, val blocks: List<Desc>, val open: Fence?)

internal data class Line(val text: String, val end: String)

internal data class Fence(val char: Char, val size: Int, val info: String)
