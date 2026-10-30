package ai.kilocode.client.session

import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.SessionDto

sealed interface SessionRef {
    enum class Type { LOCAL, CLOUD, HOSTED }

    val type: Type
    val id: String
    val key: String

    data class Local(override val id: String, val session: SessionDto? = null) : SessionRef {
        constructor(session: SessionDto) : this(session.id, session)

        override val type: Type get() = Type.LOCAL
        override val key: String get() = id
    }

    /** Legacy Cloud snapshot import into local storage. */
    data class Cloud(override val id: String, val session: CloudSessionDto? = null) : SessionRef {
        constructor(session: CloudSessionDto) : this(session.id, session)

        override val type: Type get() = Type.CLOUD
        override val key: String get() = "$CLOUD_PREFIX$id"
    }

    /**
     * A live Cloud session reached through a local Session Host attachment.
     *
     * The id is the composite `hosted:<provider>:<workspace>:<native-session>`, so two workspaces
     * that happen to share a native session id still open, cache, and stream independently. The
     * native id alone must never be used as a frontend key.
     */
    data class Hosted(
        val providerID: String,
        val workspaceID: String,
        val sessionID: String,
        val title: String? = null,
    ) : SessionRef {
        override val type: Type get() = Type.HOSTED
        override val id: String get() = HostedIDs.session(providerID, workspaceID, sessionID)
        override val key: String get() = id
        val workspaceKey: String get() = HostedIDs.workspace(providerID, workspaceID)
    }

    companion object {
        const val CLOUD_PREFIX = "cloud:"

        fun from(id: String?): SessionRef? {
            val value = id?.takeIf { it.isNotBlank() } ?: return null
            HostedIDs.parseSession(value)?.let { (provider, workspace, session) ->
                return Hosted(provider, workspace, session)
            }
            if (value.startsWith(CLOUD_PREFIX)) return Cloud(value.removePrefix(CLOUD_PREFIX))
            return Local(value)
        }

        fun cloud(id: String?): Cloud? {
            return from(id) as? Cloud
        }

        fun hosted(providerID: String, workspaceID: String, sessionID: String, title: String? = null): Hosted =
            Hosted(providerID, workspaceID, sessionID, title)
    }
}
