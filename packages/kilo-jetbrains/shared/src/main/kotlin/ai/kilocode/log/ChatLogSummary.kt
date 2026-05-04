package ai.kilocode.log

import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.TodoDto

object ChatLogSummary {
    fun sid(id: String?): String = "sid=${id ?: "global"}"

    fun sid(event: ChatEventDto): String? = when (event) {
        is ChatEventDto.MessageUpdated -> event.sessionID
        is ChatEventDto.PartUpdated -> event.sessionID
        is ChatEventDto.PartDelta -> event.sessionID
        is ChatEventDto.PartRemoved -> event.sessionID
        is ChatEventDto.TurnOpen -> event.sessionID
        is ChatEventDto.TurnClose -> event.sessionID
        is ChatEventDto.Error -> event.sessionID
        is ChatEventDto.MessageRemoved -> event.sessionID
        is ChatEventDto.PermissionAsked -> event.sessionID
        is ChatEventDto.PermissionReplied -> event.sessionID
        is ChatEventDto.QuestionAsked -> event.sessionID
        is ChatEventDto.QuestionReplied -> event.sessionID
        is ChatEventDto.QuestionRejected -> event.sessionID
        is ChatEventDto.SessionStatusChanged -> event.sessionID
        is ChatEventDto.SessionIdle -> event.sessionID
        is ChatEventDto.SessionCompacted -> event.sessionID
        is ChatEventDto.SessionDiffChanged -> event.sessionID
        is ChatEventDto.TodoUpdated -> event.sessionID
    }

    fun dir(dir: String): String = "dirHash=${hash(dir)}"

    fun body(text: String): String {
        val out = mutableListOf<String>()
        out += "chars=${text.length}"
        preview(text)?.let { out += "preview=\"$it\"" }
        return out.joinToString(" ")
    }

    fun prompt(text: String): String = join("kind=prompt", body(text))

    fun prompt(prompt: PromptDto): String {
        val out = mutableListOf<String>()
        val text = prompt.parts.joinToString("\n") { it.text }
        out += "kind=prompt"
        out += "parts=${prompt.parts.size}"
        out += "chars=${text.length}"
        prompt.parts.map { it.type }
            .distinct()
            .takeIf { it.isNotEmpty() }
            ?.let { out += "types=${it.joinToString(",")}" }
        prompt.agent?.takeIf { it.isNotBlank() }?.let { out += "agent=$it" }
        model(prompt.providerID, prompt.modelID)?.let { out += "model=$it" }
        preview(text)?.let { out += "preview=\"$it\"" }
        return out.joinToString(" ")
    }

    fun history(items: List<MessageWithPartsDto>): String {
        val out = mutableListOf<String>()
        val parts = items.sumOf { it.parts.size }
        val chars = items.sumOf { item -> item.parts.sumOf { it.text?.length ?: 0 } }
        val roles = items.map { it.info.role }.distinct()
        out += "kind=history"
        out += "messages=${items.size}"
        out += "parts=$parts"
        out += "chars=$chars"
        roles.takeIf { it.isNotEmpty() }?.let { out += "roles=${it.joinToString(",")}" }
        items.firstOrNull()?.info?.id?.let { out += "first=$it" }
        items.lastOrNull()?.info?.id?.takeIf { it != items.firstOrNull()?.info?.id }?.let { out += "last=$it" }
        return out.joinToString(" ")
    }

    fun permission(req: PermissionRequestDto): String = permission(req, true)

    fun question(req: QuestionRequestDto): String = question(req, true)

    fun status(dto: SessionStatusDto): String {
        val out = mutableListOf<String>()
        out += "type=${dto.type}"
        dto.attempt?.let { out += "attempt=$it" }
        dto.next?.let { out += "next=$it" }
        dto.requestID?.takeIf { it.isNotBlank() }?.let { out += "rid=$it" }
        dto.message?.takeIf { it.isNotBlank() }?.let { msg -> statusPreview(msg)?.let { out += "message=\"$it\"" } }
        return out.joinToString(" ")
    }

    fun event(event: ChatEventDto): String = when (event) {
        is ChatEventDto.MessageUpdated -> join(
            sid(event.sessionID),
            "evt=message.updated",
            message(event.info),
        )

        is ChatEventDto.PartUpdated -> join(
            sid(event.sessionID),
            "evt=message.part.updated",
            part(event.part),
        )

        is ChatEventDto.PartDelta -> join(
            sid(event.sessionID),
            "evt=message.part.delta",
            "mid=${event.messageID}",
            "pid=${event.partID}",
            "field=${event.field}",
            body(event.delta),
        )

        is ChatEventDto.PartRemoved -> join(
            sid(event.sessionID),
            "evt=message.part.removed",
            "mid=${event.messageID}",
            "pid=${event.partID}",
        )

        is ChatEventDto.TurnOpen -> join(
            sid(event.sessionID),
            "evt=session.turn.open",
        )

        is ChatEventDto.TurnClose -> join(
            sid(event.sessionID),
            "evt=session.turn.close",
            "reason=${event.reason}",
        )

        is ChatEventDto.Error -> join(
            sid(event.sessionID),
            "evt=session.error",
            event.error?.type?.let { "err=$it" },
            event.error?.message?.let { msg -> preview(msg)?.let { "message=\"$it\"" } },
        )

        is ChatEventDto.MessageRemoved -> join(
            sid(event.sessionID),
            "evt=message.removed",
            "mid=${event.messageID}",
        )

        is ChatEventDto.PermissionAsked -> join(
            sid(event.sessionID),
            "evt=permission.asked",
            permission(event.request, false),
        )

        is ChatEventDto.PermissionReplied -> join(
            sid(event.sessionID),
            "evt=permission.replied",
            "rid=${event.requestID}",
        )

        is ChatEventDto.QuestionAsked -> join(
            sid(event.sessionID),
            "evt=question.asked",
            question(event.request, false),
        )

        is ChatEventDto.QuestionReplied -> join(
            sid(event.sessionID),
            "evt=question.replied",
            "rid=${event.requestID}",
        )

        is ChatEventDto.QuestionRejected -> join(
            sid(event.sessionID),
            "evt=question.rejected",
            "rid=${event.requestID}",
        )

        is ChatEventDto.SessionStatusChanged -> join(
            sid(event.sessionID),
            "evt=session.status",
            status(event.status),
        )

        is ChatEventDto.SessionIdle -> join(
            sid(event.sessionID),
            "evt=session.idle",
        )

        is ChatEventDto.SessionCompacted -> join(
            sid(event.sessionID),
            "evt=session.compacted",
        )

        is ChatEventDto.SessionDiffChanged -> join(
            sid(event.sessionID),
            "evt=session.diff",
            diff(event.diff),
        )

        is ChatEventDto.TodoUpdated -> join(
            sid(event.sessionID),
            "evt=todo.updated",
            todos(event.todos),
        )
    }

    fun eventBody(event: ChatEventDto): String = event(event).substringAfter("evt=").let { body ->
        val evt = body.substringBefore(' ')
        val rest = body.substringAfter(' ', "")
        join("evt=$evt", rest)
    }

    private fun message(dto: MessageDto): String = join(
        "mid=${dto.id}",
        "role=${dto.role}",
        dto.agent?.takeIf { it.isNotBlank() }?.let { "agent=$it" },
        model(dto.providerID, dto.modelID)?.let { "model=$it" },
        dto.error?.type?.let { "err=$it" },
    )

    private fun part(dto: PartDto): String = join(
        "mid=${dto.messageID}",
        "pid=${dto.id}",
        "type=${dto.type}",
        dto.tool?.takeIf { it.isNotBlank() }?.let { "tool=$it" },
        dto.callID?.takeIf { it.isNotBlank() }?.let { "call=$it" },
        dto.state?.takeIf { it.isNotBlank() }?.let { "state=$it" },
        dto.title?.takeIf { it.isNotBlank() }?.let { title -> preview(title)?.let { "title=\"$it\"" } },
        dto.text?.let { body(it) },
    )

    private fun permission(req: PermissionRequestDto, sid: Boolean): String {
        val out = mutableListOf<String>()
        if (sid) out += "sid=${req.sessionID}"
        out += "rid=${req.id}"
        out += "permission=${req.permission}"
        out += "patterns=${req.patterns.size}"
        out += "always=${req.always.size}"
        out += "meta=${req.metadata.size}"
        req.tool?.messageID?.let { out += "toolMid=$it" }
        req.tool?.callID?.let { out += "call=$it" }
        req.patterns.firstOrNull()?.let { item -> preview(item)?.let { out += "sample=\"$it\"" } }
        return out.joinToString(" ")
    }

    private fun question(req: QuestionRequestDto, sid: Boolean): String {
        val out = mutableListOf<String>()
        val opts = req.questions.sumOf { it.options.size }
        if (sid) out += "sid=${req.sessionID}"
        out += "rid=${req.id}"
        out += "questions=${req.questions.size}"
        out += "options=$opts"
        req.tool?.messageID?.let { out += "toolMid=$it" }
        req.tool?.callID?.let { out += "call=$it" }
        req.questions.firstOrNull()?.question?.let { item -> preview(item)?.let { out += "preview=\"$it\"" } }
        return out.joinToString(" ")
    }

    private fun diff(items: List<DiffFileDto>): String {
        val adds = items.sumOf { it.additions }
        val dels = items.sumOf { it.deletions }
        val chars = items.sumOf { it.patch?.length ?: 0 }
        return join(
            "files=${items.size}",
            "adds=$adds",
            "dels=$dels",
            "patchChars=$chars",
        )
    }

    private fun todos(items: List<TodoDto>): String {
        val out = mutableListOf<String>()
        out += "todos=${items.size}"
        items.groupBy { it.status }
            .toSortedMap()
            .forEach { (key, value) -> out += "$key=${value.size}" }
        return out.joinToString(" ")
    }

    private fun model(provider: String?, model: String?): String? {
        if (provider.isNullOrBlank() || model.isNullOrBlank()) return null
        return "$provider/$model"
    }

    private fun join(vararg parts: String?): String =
        parts.filterNotNull().filter { it.isNotBlank() }.joinToString(" ")

    private fun preview(text: String): String? {
        val mode = mode()
        if (mode == Mode.OFF) return null
        val raw = clean(text)
        if (raw.isEmpty()) return null
        val cut = if (mode == Mode.FULL) raw else raw.take(max())
        return if (cut.length == raw.length) cut else "$cut..."
    }

    private fun statusPreview(text: String): String? {
        val raw = clean(text)
        if (raw.isEmpty()) return null
        val mode = mode()
        val cut = if (mode == Mode.FULL) raw else raw.take(max())
        return if (cut.length == raw.length) cut else "$cut..."
    }

    private fun clean(text: String): String = text
        .replace(Regex("\\s+"), " ")
        .replace("\"", "'")
        .trim()

    private fun hash(text: String): String = text.hashCode().toUInt().toString(16)

    private fun mode(): Mode = when ((System.getProperty("kilo.dev.log.chat.content") ?: "off").lowercase()) {
        "preview" -> Mode.PREVIEW
        "full" -> Mode.FULL
        else -> Mode.OFF
    }

    private fun max(): Int = (System.getProperty("kilo.dev.log.chat.preview.max")?.toIntOrNull() ?: 160)
        .coerceIn(1, 2000)

    private enum class Mode {
        OFF,
        PREVIEW,
        FULL,
    }
}
