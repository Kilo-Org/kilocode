package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

/** One message on a shared agent board (see `BoardStore.Message` in the CLI). */
@Serializable
data class BoardMessageDto(
    val id: String,
    val timestamp: Long,
    val from: String,
    val to: String,
    val fromLabel: String? = null,
    val toLabel: String? = null,
    val type: String,
    val body: String,
    val reply_to: String? = null,
)

/**
 * The shared agent board for one root session
 * (`GET`/`POST /kilocode/session/{id}/board[/reset]`, see `BoardStore.SessionBoard` in the CLI).
 * [messages] is oldest-first, paged backward via [cursor]/[hasMore]. [revision] is required to
 * reset the board and changes whenever a new message is stored.
 */
@Serializable
data class SessionBoardDto(
    val ownerSessionID: String,
    val revision: Int,
    val messages: List<BoardMessageDto>,
    val cursor: String? = null,
    val hasMore: Boolean,
)
