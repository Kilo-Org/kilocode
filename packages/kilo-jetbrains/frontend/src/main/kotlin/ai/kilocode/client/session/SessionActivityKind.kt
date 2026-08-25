package ai.kilocode.client.session

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
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
