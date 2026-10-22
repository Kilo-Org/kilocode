package ai.kilocode.client.session.board

import ai.kilocode.client.session.AgentAvatar
import ai.kilocode.client.session.AgentAvatarIdentity
import ai.kilocode.client.session.views.SessionViewIcons
import javax.swing.Icon

/**
 * Per-dialog generated avatar cache for the shared agent board. `main` and `ALL` are not subagents,
 * so they get the ordinary task glyph; every other participant gets the same deterministic dot-glyph
 * identity used on task cards and background-agent rows (see
 * [ai.kilocode.client.session.AgentAvatar]), colored by its position in [order] (the board's
 * participant order — `main` first, then child sessions in spawn order, see
 * [ai.kilocode.client.session.model.SessionModel.childSessions]).
 *
 * Scoped to one [SessionBoardDialog] instance rather than a global object: the board is short-lived
 * and its participant set is small, so caching by participant id here cannot grow past the dialog's
 * own lifetime the way a static, application-wide cache would.
 */
internal class BoardAvatars(order: List<String>) {
    private val palette = AgentAvatarIdentity.palette(order.filterNot { it == "main" || it == "ALL" })
    private val cache = HashMap<String, Icon>()

    /** [id]'s avatar. Always static — the board shows history, not live run state. */
    fun icon(id: String): Icon {
        if (id == "main" || id == "ALL") return SessionViewIcons.task
        return cache.getOrPut(id) { AgentAvatar.static(id, palette[id]) }
    }
}
