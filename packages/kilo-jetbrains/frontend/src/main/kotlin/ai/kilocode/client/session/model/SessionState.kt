package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto

/**
 * Pure data holder for the active session's messages, parts, and
 * workspace state (agents, models, selection).
 *
 * **EDT-only access** — no synchronization. [SessionModel] guarantees
 * all reads and writes happen on the EDT.
 */
class SessionState {

    private val messages = LinkedHashMap<String, MessageData>()

    // --- App lifecycle state (set by SessionModel, read by EmptyChatUi) ---

    var app: KiloAppStateDto = KiloAppStateDto(KiloAppStatusDto.DISCONNECTED)
    var version: String? = null

    // --- Workspace state (set by SessionModel, read by UI) ---

    var workspace: KiloWorkspaceStateDto = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING)
    var agents: List<AgentItem> = emptyList()
    var models: List<ModelItem> = emptyList()
    var agent: String? = null
    var model: String? = null
    var ready: Boolean = false
    var showMessages: Boolean = false

    // --- Read ---

    fun message(id: String): MessageData? = messages[id]

    fun messages(): Collection<MessageData> = messages.values

    fun part(messageId: String, partId: String): PartData? =
        messages[messageId]?.parts?.get(partId)

    fun isEmpty(): Boolean = messages.isEmpty()

    // --- Write (called by SessionModel on EDT) ---

    /**
     * Add a message. Returns false if the message already exists.
     */
    fun addMessage(info: MessageDto): Boolean {
        if (messages.containsKey(info.id)) return false
        messages[info.id] = MessageData(info, LinkedHashMap())
        return true
    }

    /**
     * Remove a message by ID. Returns false if not found.
     */
    fun removeMessage(id: String): Boolean =
        messages.remove(id) != null

    /**
     * Create or replace a part entry and set its text from [PartDto.text].
     */
    fun updatePart(messageId: String, part: PartDto) {
        val msg = messages[messageId] ?: return
        val text = StringBuilder(part.text ?: "")
        msg.parts[part.id] = PartData(part, text)
    }

    /**
     * Append a text delta to an existing part. Creates the part if missing.
     */
    fun appendDelta(messageId: String, partId: String, delta: String) {
        val msg = messages[messageId] ?: return
        val existing = msg.parts[partId]
        if (existing != null) {
            existing.text.append(delta)
        } else {
            msg.parts[partId] = PartData(
                PartDto(id = partId, sessionID = "", messageID = messageId, type = "text"),
                StringBuilder(delta),
            )
        }
    }

    /**
     * Bulk-load message history from RPC DTOs. Clears existing data first.
     */
    fun load(history: List<MessageWithPartsDto>) {
        messages.clear()
        for (msg in history) {
            val parts = LinkedHashMap<String, PartData>()
            for (part in msg.parts) {
                parts[part.id] = PartData(part, StringBuilder(part.text ?: ""))
            }
            messages[msg.info.id] = MessageData(msg.info, parts)
        }
    }

    fun clear() {
        messages.clear()
    }
}

data class MessageData(
    val info: MessageDto,
    val parts: LinkedHashMap<String, PartData>,
)

class PartData(
    val dto: PartDto,
    val text: StringBuilder,
)

data class AgentItem(val name: String, val display: String)

data class ModelItem(val id: String, val display: String, val provider: String)
