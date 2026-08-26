package ai.kilocode.client.session

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.SessionActivityKindDto
import javax.swing.Icon

enum class SessionActivityKind {
    RUNNING,
    LOGIN_REQUIRED,
    PERMISSION,
    PLAN,
    QUESTION,
    ERROR,
    ;

    fun label(): String = when (this) {
        RUNNING -> KiloBundle.message("session.part.tool.running")
        LOGIN_REQUIRED -> KiloBundle.message("history.badge.loginRequired")
        PERMISSION -> KiloBundle.message("history.badge.permission")
        PLAN -> KiloBundle.message("history.badge.plan")
        QUESTION -> KiloBundle.message("history.badge.question")
        ERROR -> KiloBundle.message("history.badge.error")
    }

    fun style(): UiStyle.Badge.Style = when (this) {
        RUNNING -> UiStyle.Badge.ActivityRunning
        LOGIN_REQUIRED, PERMISSION, PLAN, QUESTION -> UiStyle.Badge.ActivityAttention
        ERROR -> UiStyle.Badge.ActivityError
    }

    fun icon(): Icon = ActivityIcon.of(this)
}

/**
 * The backend reports activity for every session it knows, open or not. LOGIN_REQUIRED has no DTO
 * counterpart: it comes from live session UI state instead.
 */
internal fun SessionActivityKindDto.toKind(): SessionActivityKind = when (this) {
    SessionActivityKindDto.RUNNING -> SessionActivityKind.RUNNING
    SessionActivityKindDto.QUESTION -> SessionActivityKind.QUESTION
    SessionActivityKindDto.PLAN -> SessionActivityKind.PLAN
    SessionActivityKindDto.PERMISSION -> SessionActivityKind.PERMISSION
    SessionActivityKindDto.ERROR -> SessionActivityKind.ERROR
}
