package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.TodoDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer

/**
 * Pure session model — single source of truth for session content and runtime state.
 *
 * **EDT-only access** — no synchronization. [ai.kilocode.client.session.SessionController] guarantees all
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
        val SILENT_PART_TYPES = setOf("step-start", "step-finish")
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
    var showMessages: Boolean = false

    var state: SessionState = SessionState.Idle
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
            return false
        }
        val msg = Message(dto)
        entries[dto.id] = msg
        fire(SessionModelEvent.MessageAdded(msg))
        regroup()
        return true
    }

    /** @deprecated Use [upsertMessage] instead. Kept for incremental migration. */
    fun addMessage(dto: MessageDto): Message? {
        if (entries.containsKey(dto.id)) return null
        val msg = Message(dto)
        entries[dto.id] = msg
        fire(SessionModelEvent.MessageAdded(msg))
        regroup()
        return msg
    }

    fun removeMessage(id: String) {
        if (entries.remove(id) == null) return
        fire(SessionModelEvent.MessageRemoved(id))
        regroup()
    }

    fun removeContent(messageId: String, contentId: String) {
        val msg = entries[messageId] ?: return
        if (msg.parts.remove(contentId) == null) return
        fire(SessionModelEvent.ContentRemoved(messageId, contentId))
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
    }

    fun setState(state: SessionState) {
        this.state = state
        fire(SessionModelEvent.StateChanged(state))
    }

    fun setDiff(diff: List<DiffFileDto>) {
        this.diff = diff
        fire(SessionModelEvent.DiffUpdated(diff))
    }

    fun setTodos(todos: List<TodoDto>) {
        this.todos = todos
        fire(SessionModelEvent.TodosUpdated(todos))
    }

    fun markCompacted() {
        compactionCount++
        fire(SessionModelEvent.Compacted(compactionCount))
    }

    fun loadHistory(history: List<MessageWithPartsDto>) {
        entries.clear()
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
    }

    fun clear() {
        entries.clear()
        turnEntries.clear()
        state = SessionState.Idle
        diff = emptyList()
        todos = emptyList()
        compactionCount = 0
        fire(SessionModelEvent.Cleared)
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
            }
            is Tool -> {
                existing.state = parseToolState(dto.state)
                existing.title = dto.title
            }
            is Compaction -> return
            is Generic -> return
        }
        fire(SessionModelEvent.ContentUpdated(messageId, existing))
    }

    private fun fromDto(dto: PartDto, text: CharSequence? = null): Content {
        val content = text ?: dto.text
        return when (dto.type) {
            "text" -> Text(dto.id).apply {
                if (content != null && content.isNotEmpty()) this.content.append(content)
            }
            "reasoning" -> Reasoning(dto.id).apply {
                if (content != null && content.isNotEmpty()) this.content.append(content)
            }
            "tool" -> Tool(dto.id, dto.tool ?: "unknown").apply {
                state = parseToolState(dto.state)
                title = dto.title
            }
            "compaction" -> Compaction(dto.id)
            else -> Generic(dto.id, dto.type)
        }
    }

    private fun fire(event: SessionModelEvent) {
        for (l in listeners) l.onEvent(event)
    }

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

data class AgentItem(val name: String, val display: String)

data class ModelItem(val id: String, val display: String, val provider: String)

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
                out.add("reasoning#${part.id}:")
                out.addAll(renderText(part.content))
            }
            is Tool -> out.add(renderTool(part))
            is Compaction -> out.add("compaction#${part.id}")
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
    return "tool#${tool.id} ${tool.name} [$state]$title"
}

private fun renderText(text: CharSequence): List<String> {
    val raw = text.toString()
    if (raw.isEmpty()) return listOf("  <empty>")
    return raw.split("\n").map { "  $it" }
}
