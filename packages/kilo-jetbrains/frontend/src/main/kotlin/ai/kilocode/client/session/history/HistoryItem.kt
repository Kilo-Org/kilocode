package ai.kilocode.client.session.history

import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.SessionDto

sealed interface HistoryItem {
    val id: String
    val title: String
    val createdAt: String
    val updatedAt: String
}

data class LocalHistoryItem(val session: SessionDto) : HistoryItem {
    override val id: String get() = session.id
    override val title: String get() = session.title
    override val createdAt: String get() = session.time.created.toString()
    override val updatedAt: String get() = session.time.updated.toString()
    val directory: String? get() = session.directory
}

data class CloudHistoryItem(val session: CloudSessionDto) : HistoryItem {
    override val id: String get() = session.id
    override val title: String get() = session.title.orEmpty()
    override val createdAt: String get() = session.createdAt
    override val updatedAt: String get() = session.updatedAt
}

enum class HistorySource { LOCAL, CLOUD }
