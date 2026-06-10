package ai.kilocode.client.session

import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.SessionDto

sealed interface SessionRef {
    enum class Type { LOCAL, CLOUD }

    val type: Type
    val id: String
    val key: String

    data class Local(override val id: String, val session: SessionDto? = null) : SessionRef {
        constructor(session: SessionDto) : this(session.id, session)

        override val type: Type get() = Type.LOCAL
        override val key: String get() = id
    }

    data class Cloud(override val id: String, val session: CloudSessionDto? = null) : SessionRef {
        constructor(session: CloudSessionDto) : this(session.id, session)

        override val type: Type get() = Type.CLOUD
        override val key: String get() = "$CLOUD_PREFIX$id"
    }

    companion object {
        const val CLOUD_PREFIX = "cloud:"

        fun from(id: String?): SessionRef? {
            val value = id?.takeIf { it.isNotBlank() } ?: return null
            if (value.startsWith(CLOUD_PREFIX)) return Cloud(value.removePrefix(CLOUD_PREFIX))
            return Local(value)
        }

        fun cloud(id: String?): Cloud? {
            return from(id) as? Cloud
        }
    }
}
