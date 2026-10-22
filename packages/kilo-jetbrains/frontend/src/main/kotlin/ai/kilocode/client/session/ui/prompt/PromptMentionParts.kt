package ai.kilocode.client.session.ui.prompt

import ai.kilocode.rpc.dto.PartSourceDto
import ai.kilocode.rpc.dto.PartSourceTextDto
import ai.kilocode.rpc.dto.PromptPartDto
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.nio.file.Path

data class Mention(val value: String, val start: Int, val end: Int)

fun promptMentions(text: String): List<Mention> = buildList {
    var pos = 0
    while (pos < text.length) {
        val start = (pos until text.length).firstOrNull { !text[it].isWhitespace() } ?: return@buildList
        val end = tokenEnd(text, start)
        if (text[start] == '@' && end > start + 1) add(Mention(text.substring(start + 1, end), start, end))
        pos = end + 1
    }
}

fun fileMentions(text: String, reserved: Set<String>): List<Mention> {
    val seen = mutableSetOf<String>()
    return promptMentions(text).filter { item -> item.value !in reserved && seen.add(item.value) }
}

suspend fun mentionParts(
    text: String,
    directory: String,
    reserved: Set<String>,
    resolve: suspend (String) -> Boolean,
    gitChanges: suspend () -> String?,
): List<PromptPartDto> = coroutineScope {
    val files = fileMentions(text, reserved)
    val paths = files.map { item -> async { item.value to resolve(item.value) } }
        .mapNotNullTo(mutableSetOf()) { item -> item.await().takeIf { it.second }?.first }
    buildList {
        addAll(mentionFileParts(text, paths, directory))
        if (text.contains(MentionAction.GIT_CHANGES.token)) gitChangesPart(text, gitChanges())?.let(::add)
    }
}

fun mentionFileParts(text: String, paths: Set<String>, directory: String): List<PromptPartDto> = buildList {
    fileMentions(text, emptySet()).filter { item -> item.value in paths }.forEach { mention ->
        val target = runCatching {
            val item = Path.of(mention.value)
            if (item.isAbsolute) item else Path.of(directory).resolve(item).normalize()
        }.getOrNull() ?: return@forEach
        add(PromptPartDto(
            type = "file",
            mime = "text/plain",
            url = target.toUri().toString(),
            filename = target.fileName?.toString(),
            source = source("file", "@${mention.value}", mention.start, path = mention.value),
        ))
    }
}

fun gitChangesPart(text: String, diff: String?): PromptPartDto? {
    val spec = MentionAction.GIT_CHANGES
    val start = text.mentionStart(spec.token) ?: return null
    val value = diff?.takeIf { it.isNotBlank() } ?: return null
    return dataPart(spec.filename, value, source("file", spec.token, start, path = spec.uri))
}

private fun String.mentionStart(token: String): Int? = promptMentions(this)
    .firstOrNull { item -> "@${item.value}" == token }
    ?.start

private fun tokenEnd(text: String, start: Int): Int =
    (start until text.length).firstOrNull { text[it].isWhitespace() } ?: text.length

private fun dataPart(name: String, text: String, source: PartSourceDto? = null): PromptPartDto {
    val data = URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20")
    return PromptPartDto(type = "file", mime = "text/plain", url = "data:text/plain;charset=utf-8,$data", filename = name, source = source)
}

private fun source(
    type: String,
    token: String,
    start: Int,
    path: String? = null,
) = PartSourceDto(
    type = type,
    text = PartSourceTextDto(value = token, start = start.toDouble(), end = (start + token.length).toDouble()),
    path = path,
)
