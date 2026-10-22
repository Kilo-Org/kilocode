package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.model.Message

data class PromptMention(
    val token: String,
    val path: String,
    val start: Int,
    val end: Int,
    val attachment: FileAttachment? = null,
)

fun promptMentions(msg: Message): List<PromptMention> = msg.parts.values.mapNotNull { part ->
    if (part !is FileAttachment) return@mapNotNull null
    if (!part.mime.lowercase().startsWith("text/plain")) return@mapNotNull null
    val source = part.source ?: return@mapNotNull null
    val path = source.path?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
    PromptMention(
        token = source.text.value,
        path = path,
        start = source.text.start.toInt(),
        end = source.text.end.toInt(),
        attachment = part,
    )
}

fun linkifyMentions(text: String, mentions: List<PromptMention>): String {
    if (mentions.isEmpty()) return text
    val ranges = mutableListOf<Pair<IntRange, PromptMention>>()
    val used = mutableListOf<IntRange>()
    for (mention in mentions) {
        val range = exact(text, mention)?.takeUnless { overlaps(it, used) }
            ?: fallback(text, mention, used)
            ?: continue
        ranges.add(range to mention)
        used.add(range)
    }
    val out = StringBuilder(text)
    for ((range, mention) in ranges.sortedByDescending { it.first.first }) {
        val link = link(mention)
        out.replace(range.first, range.last + 1, link)
    }
    return out.toString()
}

private fun exact(text: String, mention: PromptMention): IntRange? {
    if (mention.start < 0 || mention.end > text.length || mention.start >= mention.end) return null
    if (text.substring(mention.start, mention.end) != mention.token) return null
    return mention.start until mention.end
}

private fun fallback(text: String, mention: PromptMention, used: List<IntRange>): IntRange? {
    if (mention.token.isEmpty()) return null
    var at = text.indexOf(mention.token)
    while (at >= 0) {
        val range = at until at + mention.token.length
        if (!overlaps(range, used)) return range
        at = text.indexOf(mention.token, at + 1)
    }
    return null
}

private fun overlaps(range: IntRange, used: List<IntRange>): Boolean =
    used.any { range.first <= it.last && it.first <= range.last }

private fun link(mention: PromptMention): String {
    val text = mention.token.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
    val href = mention.path.replace(" ", "%20").replace("(", "%28").replace(")", "%29")
    return "[$text]($href)"
}
