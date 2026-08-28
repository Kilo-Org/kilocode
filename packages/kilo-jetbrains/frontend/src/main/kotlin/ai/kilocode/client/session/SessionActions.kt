package ai.kilocode.client.session

import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.openapi.actionSystem.DataKey

/**
 * Session-scoped capabilities the right-click context menu actions act on.
 *
 * Implemented by [SessionUi] and published from its `uiDataSnapshot`. `SessionUi` is an ancestor of
 * every component in the session, and `DataManager` collects data along the whole ancestor chain, so
 * a right-click anywhere inside the session resolves this key.
 */
internal interface SessionActions {
    /** Session id, or null while the session has not been created yet (created on first prompt). */
    val id: String?

    /** True for hosts that only display a session, such as subagent tabs. Hides mutating actions. */
    val readonly: Boolean

    /** Pull request for the session directory's branch, when `gh` reported one. */
    val pr: WorktreePrDto?

    /** Public share URL, when this session is shared. */
    val share: String?

    /** Whether git is usable in the session directory. */
    val git: Boolean

    /** App-wide auto-approve state (IDE-level, not per session). */
    val auto: Boolean

    fun setAuto(value: Boolean)

    /** Opens the branch diff (merge-base to working tree) editor for the session directory. */
    fun compare()

    /** Shares the session, then copies the link and reports the outcome. */
    fun startShare()

    /** Revokes the session share, then reports the outcome. */
    fun stopShare()
}

internal object SessionActionsKeys {
    val ACTIONS: DataKey<SessionActions> = DataKey.create("kilo.session.actions")
}
