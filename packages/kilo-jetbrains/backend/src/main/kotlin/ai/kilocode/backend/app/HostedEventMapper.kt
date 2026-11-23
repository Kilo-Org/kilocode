package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto

/**
 * Rewrites provider-native session ids into composite hosted identities before they reach the
 * shared chat stream. Everything downstream — activity maps, pending prompt recovery, per-session
 * subscriptions, and editor controller filters — then keys hosted sessions without ever seeing a
 * bare native id that could collide with another workspace.
 */
internal object HostedEventMapper {
    fun event(event: ChatEventDto, composite: String, directory: String): ChatEventDto = when (event) {
        is ChatEventDto.MessageUpdated -> event.copy(
            sessionID = composite,
            info = event.info.copy(sessionID = composite),
        )
        is ChatEventDto.MessageTerminal -> event.copy(sessionID = composite)
        is ChatEventDto.PartUpdated -> event.copy(
            sessionID = composite,
            part = event.part.copy(sessionID = composite),
        )
        is ChatEventDto.PartDelta -> event.copy(sessionID = composite)
        is ChatEventDto.PartRemoved -> event.copy(sessionID = composite)
        is ChatEventDto.TurnOpen -> event.copy(sessionID = composite)
        is ChatEventDto.TurnClose -> event.copy(sessionID = composite)
        is ChatEventDto.SessionCreated -> event.copy(
            sessionID = composite,
            info = event.info.copy(id = composite, directory = directory),
        )
        is ChatEventDto.Error -> event.copy(sessionID = composite)
        is ChatEventDto.MessageRemoved -> event.copy(sessionID = composite)
        is ChatEventDto.PermissionAsked -> event.copy(
            sessionID = composite,
            request = event.request.copy(sessionID = composite),
        )
        is ChatEventDto.PermissionReplied -> event.copy(sessionID = composite)
        is ChatEventDto.QuestionAsked -> event.copy(
            sessionID = composite,
            request = event.request.copy(sessionID = composite),
        )
        is ChatEventDto.QuestionReplied -> event.copy(sessionID = composite)
        is ChatEventDto.QuestionRejected -> event.copy(sessionID = composite)
        is ChatEventDto.SessionStatusChanged -> event.copy(sessionID = composite)
        is ChatEventDto.SessionUpdated -> event.copy(
            sessionID = composite,
            session = event.session.copy(id = composite, directory = directory),
        )
        is ChatEventDto.SessionIdle -> event.copy(sessionID = composite)
        is ChatEventDto.SessionQueueChanged -> event.copy(sessionID = composite)
        is ChatEventDto.SessionCompacted -> event.copy(sessionID = composite)
        is ChatEventDto.SessionDiffChanged -> event.copy(sessionID = composite)
        is ChatEventDto.TodoUpdated -> event.copy(sessionID = composite)
        is ChatEventDto.SessionInterrupted -> event.copy(sessionID = composite)
        is ChatEventDto.Resnapshot -> event.copy(sessionID = composite)
    }

    fun messages(items: List<MessageWithPartsDto>, composite: String): List<MessageWithPartsDto> =
        items.map { item ->
            item.copy(
                info = item.info.copy(sessionID = composite),
                parts = item.parts.map { it.copy(sessionID = composite) },
            )
        }

    fun session(
        composite: String,
        directory: String,
        title: String?,
        created: Double,
        updated: Double,
    ): SessionDto = SessionDto(
        id = composite,
        projectID = "cloud",
        directory = directory,
        title = title?.takeIf { it.isNotBlank() } ?: "Cloud session",
        version = "cloud",
        time = SessionTimeDto(created = created, updated = updated),
    )
}
