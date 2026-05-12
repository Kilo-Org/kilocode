package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TokensDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import kotlin.math.roundToInt

/**
 * Pure session model — single source of truth for session content and runtime state.
 *
 * **EDT-only access** — no synchronization. [ai.kilocode.client.session.controller.SessionController] guarantees all
 * reads and writes happen on the EDT.
 *
 * In addition to the flat message list, the model maintains a derived
 * **turn grouping**: a [Turn] starts with each user message and collects
 * the following assistant messages. Leading assistant messages (before the
 * first user message) form their own standalone turn.
 *
 * Turn grouping is recomputed after every message add/remove, and the
 * diff is emitted as [SessionModelEvent.TurnAdded], [SessionModelEvent.TurnUpdated],
 * or [SessionModelEvent.TurnRemoved] events *after* the message event that
 * triggered the change.
 */
class SessionModel {

    companion object {
        /** Part types that are internal server markers and must never be stored or rendered. */
        val SILENT_PART_TYPES = setOf("step-start")
    }

    private val entries = LinkedHashMap<String, Message>()
    private val turnEntries = LinkedHashMap<String, Turn>()

    var app: KiloAppStateDto = KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
    var version: String? = null

    var workspace: KiloWorkspaceStateDto = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING)
    var agents: List<AgentItem> = emptyList()
    var models: List<ModelItem> = emptyList()
    var agent: String? = null
    var model: String? = null
    var defaultModel: String? = null
    var modelOverride: Boolean = false
    var variants: List<String> = emptyList()
    var variant: String? = null
    var showSession: Boolean = false

    var state: SessionState = SessionState.Idle
        private set

    var session: SessionDto? = null
        private set

    var header: SessionHeaderSnapshot = emptyHeader()
        private set

    var diff: List<DiffFileDto> = emptyList()
        private set

    var todos: List<TodoDto> = emptyList()
        private set

    var compactionCount: Int = 0
        private set

    private val listeners = mutableListOf<SessionModelEvent.Listener>()

    fun addListener(parent: Disposable, listener: SessionModelEvent.Listener) {
        listeners.add(listener)
        Disposer.register(parent) { listeners.remove(listener) }
    }

    fun messages(): Collection<Message> = entries.values

    fun message(id: String): Message? = entries[id]

    fun content(messageId: String, contentId: String): Content? = entries[messageId]?.parts?.get(contentId)

    fun turns(): Collection<Turn> = turnEntries.values

    fun turn(id: String): Turn? = turnEntries[id]

    fun isEmpty(): Boolean = entries.isEmpty()

    fun isReady(): Boolean = app.status == KiloAppStatusDto.READY && workspace.status == KiloWorkspaceStatusDto.READY

    /**
     * Add a message if it doesn't exist, or update its [MessageDto] info if it does.
     * Returns true when the message was newly added (caller can decide to show messages).
     */
    fun upsertMessage(dto: MessageDto): Boolean {
        val existing = entries[dto.id]
        if (existing != null) {
            val updated = Message(dto).also { it.parts.putAll(existing.parts) }
            entries[dto.id] = updated
            fire(SessionModelEvent.MessageUpdated(updated))
            updateHeader()
            return false
        }
        val msg = Message(dto)
        entries[dto.id] = msg
        fire(SessionModelEvent.MessageAdded(msg))
        regroup()
        updateHeader()
        return true
    }

    /** @deprecated Use [upsertMessage] instead. Kept for incremental migration. */
    fun addMessage(dto: MessageDto): Message? {
        if (entries.containsKey(dto.id)) return null
        val msg = Message(dto)
        entries[dto.id] = msg
        fire(SessionModelEvent.MessageAdded(msg))
        regroup()
        updateHeader()
        return msg
    }

    fun removeMessage(id: String) {
        if (entries.remove(id) == null) return
        fire(SessionModelEvent.MessageRemoved(id))
        regroup()
        updateHeader()
    }

    fun removeContent(messageId: String, contentId: String) {
        val msg = entries[messageId] ?: return
        if (msg.parts.remove(contentId) == null) return
        fire(SessionModelEvent.ContentRemoved(messageId, contentId))
        updateHeader()
    }

    fun updateContent(messageId: String, dto: PartDto) {
        if (dto.type in SILENT_PART_TYPES) return
        val msg = entries[messageId] ?: return
        val existing = msg.parts[dto.id]
        if (existing != null) {
            updateExisting(messageId, existing, dto)
            return
        }
        val content = fromDto(dto)
        msg.parts[dto.id] = content
        fire(SessionModelEvent.ContentAdded(messageId, content))
        updateHeader()
    }

    fun appendDelta(messageId: String, contentId: String, delta: String) {
        val msg = entries[messageId] ?: return
        val existing = msg.parts[contentId]
        if (existing != null) {
            val buf = when (existing) {
                is Text -> existing.content
                is Reasoning -> existing.content
                else -> return
            }
            buf.append(delta)
        } else {
            val content = Text(contentId)
            content.content.append(delta)
            msg.parts[contentId] = content
            fire(SessionModelEvent.ContentAdded(messageId, content))
        }
        fire(SessionModelEvent.ContentDelta(messageId, contentId, delta))
        updateHeader()
    }

    fun setState(state: SessionState) {
        if (this.state == state) return
        this.state = state
        fire(SessionModelEvent.StateChanged(state))
        updateHeader()
    }

    fun setSession(session: SessionDto) {
        if (this.session == session) return
        this.session = session
        fire(SessionModelEvent.SessionUpdated(session))
        updateHeader()
    }

    fun setDiff(diff: List<DiffFileDto>) {
        this.diff = diff
        fire(SessionModelEvent.DiffUpdated(diff))
    }

    fun setTodos(todos: List<TodoDto>) {
        this.todos = todos
        fire(SessionModelEvent.TodosUpdated(todos))
        updateHeader()
    }

    fun markCompacted() {
        compactionCount++
        fire(SessionModelEvent.Compacted(compactionCount))
        updateHeader()
    }

    fun refreshHeader() {
        updateHeader()
    }

    fun loadHistory(history: List<MessageWithPartsDto>) {
        entries.clear()
        session = null
        state = SessionState.Idle
        diff = emptyList()
        todos = emptyList()
        compactionCount = 0
        for (msg in history) {
            val item = Message(msg.info)
            for (part in msg.parts) {
                if (part.type in SILENT_PART_TYPES) continue
                val content = fromDto(part, part.text)
                item.parts[content.id] = content
            }
            entries[msg.info.id] = item
        }
        rebuildTurnsSilently()
        fire(SessionModelEvent.HistoryLoaded)
        updateHeader()
    }

    fun clear() {
        entries.clear()
        turnEntries.clear()
        session = null
        state = SessionState.Idle
        diff = emptyList()
        todos = emptyList()
        compactionCount = 0
        fire(SessionModelEvent.Cleared)
        updateHeader()
    }

    // ------ turn grouping ------

    /**
     * Recompute the turn grouping after a message was added or removed.
     * Diffs against the current [turnEntries] and fires [SessionModelEvent.TurnAdded],
     * [SessionModelEvent.TurnUpdated], or [SessionModelEvent.TurnRemoved] as needed.
     */
    private fun regroup() {
        val groups = computeGroups()
        val grouped = groups.associate { it }
        val prev = turnEntries.keys.toList()
        val next = groups.map { it.first }

        // Turns that no longer exist
        for (id in prev) {
            if (id !in grouped) {
                turnEntries.remove(id)
                fire(SessionModelEvent.TurnRemoved(id))
            }
        }

        // Build the new ordered map; fire Added/Updated as needed
        val rebuilt = LinkedHashMap<String, Turn>()
        for ((id, ids) in groups) {
            val existing = turnEntries[id]
            if (existing == null) {
                val turn = Turn(id).also { t -> ids.forEach { t.add(it) } }
                rebuilt[id] = turn
                fire(SessionModelEvent.TurnAdded(turn))
            } else {
                if (existing.messageIds != ids) {
                    val turn = Turn(id).also { t -> ids.forEach { t.add(it) } }
                    rebuilt[id] = turn
                    fire(SessionModelEvent.TurnUpdated(turn))
                } else {
                    rebuilt[id] = existing
                }
            }
        }

        turnEntries.clear()
        turnEntries.putAll(rebuilt)
    }

    /**
     * Rebuild turns from the current message list *without* firing any events.
     * Used by [loadHistory] and [clear] so the derived state stays consistent
     * without generating spurious turn events (the caller fires a single bulk event).
     */
    private fun rebuildTurnsSilently() {
        turnEntries.clear()
        for ((_, ids) in computeGroups()) {
            val turn = Turn(ids.first())
            ids.forEach { turn.add(it) }
            turnEntries[turn.id] = turn
        }
    }

    /**
     * Compute the canonical turn grouping from the current message insertion order.
     * Each group is a Pair of (turnId, orderedMessageIds).
     *
     * Rules:
     * - A user message always starts a new turn (turn id = user message id).
     * - Assistant messages following a user message belong to that turn.
     * - Leading assistant messages (before any user message) anchor their own turn
     *   (turn id = first assistant message id in that leading block).
     */
    private fun computeGroups(): List<Pair<String, List<String>>> {
        val result = mutableListOf<Pair<String, MutableList<String>>>()
        var cur: MutableList<String>? = null
        var curId: String? = null

        for (msg in entries.values) {
            if (msg.info.role == "user") {
                if (curId != null && cur != null) result.add(curId to cur)
                curId = msg.info.id
                cur = mutableListOf(msg.info.id)
            } else {
                if (cur == null) {
                    curId = msg.info.id
                    cur = mutableListOf(msg.info.id)
                } else {
                    cur.add(msg.info.id)
                }
            }
        }

        if (curId != null && cur != null) result.add(curId to cur)
        return result.map { (id, ids) -> id to ids.toList() }
    }

    // ------ private helpers ------

    private fun updateExisting(messageId: String, existing: Content, dto: PartDto) {
        when (existing) {
            is Text -> {
                val text = dto.text ?: return
                existing.content.clear()
                existing.content.append(text)
            }
            is Reasoning -> {
                val text = dto.text ?: return
                existing.content.clear()
                existing.content.append(text)
                existing.done = dto.time?.end != null || dto.time == null
            }
            is Tool -> {
                existing.kind = toolKind(dto.tool)
                existing.state = parseToolState(dto.state)
                existing.title = dto.title
                existing.input = dto.input
                existing.metadata = dto.metadata
                existing.output = dto.output
                existing.error = dto.error
                existing.time = dto.time
            }
            is Compaction -> return
            is StepFinish -> {
                existing.reason = dto.reason
                existing.cost = dto.cost
                existing.tokens = dto.tokens
            }
            is Generic -> return
        }
        fire(SessionModelEvent.ContentUpdated(messageId, existing))
        updateHeader()
    }

    private fun fromDto(dto: PartDto, text: CharSequence? = null): Content {
        val content = text ?: dto.text
        return when (dto.type) {
            "text" -> Text(dto.id).apply {
                if (content != null && content.isNotEmpty()) this.content.append(content)
            }
            "reasoning" -> Reasoning(dto.id).apply {
                if (content != null && content.isNotEmpty()) this.content.append(content)
                done = dto.time?.end != null || dto.time == null
            }
            "tool" -> Tool(dto.id, dto.tool ?: "unknown", toolKind(dto.tool)).apply {
                state = parseToolState(dto.state)
                title = dto.title
                input = dto.input
                metadata = dto.metadata
                output = dto.output
                error = dto.error
                time = dto.time
            }
            "compaction" -> Compaction(dto.id)
            "step-finish" -> StepFinish(dto.id).apply {
                reason = dto.reason
                cost = dto.cost
                tokens = dto.tokens
            }
            else -> Generic(dto.id, dto.type)
        }
    }

    private fun fire(event: SessionModelEvent) {
        for (l in listeners) l.onEvent(event)
    }

    private fun updateHeader() {
        val next = buildHeader()
        if (next == header) return
        header = next
        fire(SessionModelEvent.HeaderUpdated(next))
    }

    private fun buildHeader(): SessionHeaderSnapshot {
        val items = messages().toList()
        if (items.isEmpty()) return emptyHeader()
        val last = items.asReversed()
            .firstOrNull { it.info.role == "assistant" && (it.info.tokens?.total()?.let { total -> total > 0 } == true) }
        val tokens = last?.info?.tokens
        val limit = model?.let(::item)?.limit
        val total = tokens?.total() ?: 0
        val context = if (tokens == null || total == 0L) null else ContextUsage(
            tokens = total,
            percentage = limit?.context?.takeIf { it > 0 }?.let { (total.toDouble() / it.toDouble() * 100).roundToInt() },
            limit = limit?.context?.takeIf { it > 0 },
            output = limit?.output?.takeIf { it > 0 },
        )
        val cost = items
            .filter { it.info.role == "assistant" }
            .sumOf { it.info.cost ?: 0.0 }
            .takeIf { it > 0.0 }
        val done = todos.count { it.status == "completed" }
        return SessionHeaderSnapshot(
            visible = items.isNotEmpty(),
            title = session?.title?.takeIf { it.isNotBlank() } ?: "New Session",
            cost = cost,
            context = context,
            tokens = tokens,
            timeline = timeline(items),
            todos = TodoSummary(todos.size, done, todos),
            canCompact = !state.isBusy() && model?.let(::parseModelKey) != null,
        )
    }

    private fun timeline(items: List<Message>): List<TimelineItem> = items
        .filter { it.info.role == "assistant" }
        .flatMap { msg ->
            msg.parts.values.map { part ->
                TimelineItem(
                    id = "${msg.info.id}/${part.id}",
                    part = part,
                    title = part.timelineTitle(),
                    weight = part.weight().coerceIn(1, 10),
                    durationMs = (part as? Tool)?.time?.durationMs(),
                    active = (part as? Tool)?.state == ToolExecState.RUNNING || part is Reasoning && !part.done,
                )
            }
        }

    private fun item(key: String): ModelItem? = models.firstOrNull { it.key == key }

    // ------ string representations ------

    /**
     * Compact turn-grouping summary for test assertions.
     *
     * Format: one line per turn → `turn#<id>: <role>#<id>, ...`
     */
    fun toTurnsString(): String {
        if (turnEntries.isEmpty()) return "(no turns)"
        return turnEntries.values.joinToString("\n") { turn ->
            val msgs = turn.messageIds.joinToString(", ") { id ->
                val msg = entries[id]
                if (msg != null) "${msg.info.role}#$id" else "?#$id"
            }
            "turn#${turn.id}: $msgs"
        }
    }

    override fun toString(): String {
        val out = mutableListOf<String>()

        for (msg in messages()) {
            if (out.isNotEmpty()) out.add("---")
            out.addAll(renderMessage(msg))
        }

        when (val state = this.state) {
            is SessionState.AwaitingQuestion -> {
                if (out.isNotEmpty()) out.add("---")
                out.addAll(renderQuestion(state.question))
            }
            is SessionState.AwaitingPermission -> {
                if (out.isNotEmpty()) out.add("---")
                out.addAll(renderPermission(state.permission))
            }
            else -> {}
        }

        if (diff.isNotEmpty()) {
            if (out.isNotEmpty()) out.add("---")
            out.add("diff: ${diff.joinToString(" ") { it.file }}")
        }
        if (todos.isNotEmpty()) {
            if (out.isNotEmpty()) out.add("---")
            todos.forEach { out.add("todo: [${it.status}] ${it.content}") }
        }
        if (compactionCount > 0) {
            if (out.isNotEmpty()) out.add("---")
            out.add("compacted: $compactionCount")
        }

        return out.joinToString("\n")
    }
}

private fun parseToolState(raw: String?): ToolExecState = when (raw) {
    "pending" -> ToolExecState.PENDING
    "running" -> ToolExecState.RUNNING
    "completed" -> ToolExecState.COMPLETED
    "error" -> ToolExecState.ERROR
    else -> ToolExecState.PENDING
}

data class AgentItem(
    val name: String,
    val display: String,
    val description: String?,
    val deprecated: Boolean,
)

data class ModelItem(
    val id: String,
    val display: String,
    val provider: String,
    val providerName: String,
    val recommendedIndex: Double?,
    val free: Boolean,
    val variants: List<String>,
    val limit: ModelLimitItem?,
) {
    val key: String get() = "$provider/$id"
}

private fun emptyHeader() = SessionHeaderSnapshot(
    visible = false,
    title = "New Session",
    cost = null,
    context = null,
    tokens = null,
    timeline = emptyList(),
    todos = TodoSummary(0, 0, emptyList()),
    canCompact = false,
)

private fun TokensDto.total(): Long = listOf(input, output, reasoning, cacheRead, cacheWrite).fold(0L) { sum, value ->
    if (value <= 0) return@fold sum
    if (Long.MAX_VALUE - sum < value) return@fold Long.MAX_VALUE
    sum + value
}

private fun TokensDto.stepWeight(): Int = (input.coerceIn(0L, 10L) + output.coerceIn(0L, 10L) + reasoning.coerceIn(0L, 10L))
    .coerceIn(1L, 10L)
    .toInt()

private fun parseModelKey(value: String): Pair<String, String>? {
    val slash = value.indexOf('/')
    if (slash <= 0 || slash >= value.length - 1) return null
    return value.substring(0, slash) to value.substring(slash + 1)
}

private fun Content.timelineTitle(): String = when (this) {
    is Text -> "Text"
    is Reasoning -> "Reasoning"
    is Tool -> fileActionTitle() ?: title?.takeIf { it.isNotBlank() } ?: name
    is Compaction -> "Compaction"
    is StepFinish -> "Step finish"
    is Generic -> type
}

private fun Tool.fileActionTitle(): String? {
    val verb = when (kind) {
        ToolKind.READ -> "Read"
        ToolKind.WRITE -> "Write"
        ToolKind.GENERIC -> return null
    }
    val path = listOf("filePath", "path", "file")
        .asSequence()
        .mapNotNull {
            input[it]?.takeIf { value -> value.isNotBlank() }
                ?: metadata[it]?.takeIf { value -> value.isNotBlank() }
        }
        .firstOrNull()
        ?: return null
    return "$verb ${tail(path).ifBlank { path }}"
}

private fun tail(path: String): String {
    val value = path.trimEnd('/', '\\')
    val index = maxOf(value.lastIndexOf('/'), value.lastIndexOf('\\'))
    if (index < 0) return value
    return value.substring(index + 1)
}

private fun Content.weight(): Int = when (this) {
    is Text -> content.length / 200 + 1
    is Reasoning -> content.length / 200 + 1
    is Tool -> listOf(input.size, output?.length?.div(400) ?: 0, error?.length?.div(200) ?: 0).sum() + 1
    is Compaction -> 2
    is StepFinish -> tokens?.stepWeight() ?: 1
    is Generic -> 1
}

private fun ai.kilocode.rpc.dto.PartTimeDto.durationMs(): Long? {
    val start = start ?: return null
    val end = end ?: return null
    if (end < start) return null
    return ((end - start) * 1000).toLong()
}

private fun renderMessage(msg: Message): List<String> {
    val out = mutableListOf<String>()
    out.add("${msg.info.role}#${msg.info.id}")
    for (part in msg.parts.values) {
        when (part) {
            is Text -> {
                out.add("text#${part.id}:")
                out.addAll(renderText(part.content))
            }
            is Reasoning -> {
                out.add("reasoning#${part.id} done=${part.done}:")
                out.addAll(renderText(part.content))
            }
            is Tool -> out.add(renderTool(part))
            is Compaction -> out.add("compaction#${part.id}")
            is StepFinish -> out.add("step-finish#${part.id}")
            is Generic -> out.add("${part.type}#${part.id}")
        }
    }
    return out
}

private fun renderQuestion(question: Question): List<String> {
    val out = mutableListOf<String>()
    out.add("question#${question.id}")
    out.add("tool: ${renderToolRef(question.tool)}")
    for (item in question.items) {
        out.add("header: ${item.header}")
        out.add("prompt: ${item.question}")
        for (opt in item.options) {
            out.add("option: ${opt.label} - ${opt.description}")
        }
        out.add("multiple: ${item.multiple}")
        out.add("custom: ${item.custom}")
    }
    return out
}

private fun renderPermission(permission: Permission): List<String> {
    val out = mutableListOf<String>()
    out.add("permission#${permission.id}")
    out.add("tool: ${renderToolRef(permission.tool)}")
    out.add("name: ${permission.name}")
    out.add("patterns: ${permission.patterns.joinToString(", ").ifEmpty { "<none>" }}")
    out.add("always: ${permission.always.joinToString(", ").ifEmpty { "<none>" }}")
    out.add("file: ${renderFile(permission.meta)}")
    out.add("state: ${permission.state.name}")
    val meta = permission.meta.raw.entries
        .filter { it.key !in setOf("file", "path", "state") }
        .sortedBy { it.key }
        .joinToString(", ") { "${it.key}=${it.value}" }
        .ifEmpty { "<none>" }
    out.add("metadata: $meta")
    return out
}

private fun renderToolRef(ref: ToolCallRef?): String = ref?.let { "${it.messageId}/${it.callId}" } ?: "<none>"

private fun renderFile(meta: PermissionMeta): String {
    meta.filePath?.takeIf { it.isNotBlank() }?.let { return it }
    meta.raw["file"]?.takeIf { it.isNotBlank() }?.let { return it }
    meta.raw["path"]?.takeIf { it.isNotBlank() }?.let { return it }
    return "<none>"
}

private fun renderTool(tool: Tool): String {
    val state = tool.state.name
    val title = tool.title?.takeIf { it.isNotBlank() }?.let { " $it" } ?: ""
    val data = listOf(
        tool.input.takeIf { it.isNotEmpty() }?.let { " input=${renderMap(it)}" },
        tool.output?.takeIf { it.isNotBlank() }?.let { " output=${it.take(32)}" },
    ).filterNotNull().joinToString("")
    return "tool#${tool.id} ${tool.name} [$state]$title$data"
}

private fun renderMap(map: Map<String, String>): String =
    map.entries.sortedBy { it.key }.joinToString(",", "{", "}") { "${it.key}=${it.value}" }

private fun renderText(text: CharSequence): List<String> {
    val raw = text.toString()
    if (raw.isEmpty()) return listOf("  <empty>")
    return raw.split("\n").map { "  $it" }
}
