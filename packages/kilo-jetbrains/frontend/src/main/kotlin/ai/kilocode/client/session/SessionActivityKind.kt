package ai.kilocode.client.session

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle

enum class SessionActivityKind {
    RUNNING,
    LOGIN_REQUIRED,
    PERMISSION,
    PLAN,
    QUESTION,
    ;

    fun label(): String = when (this) {
        RUNNING -> KiloBundle.message("session.part.tool.running")
        LOGIN_REQUIRED -> KiloBundle.message("history.badge.loginRequired")
        PERMISSION -> KiloBundle.message("history.badge.permission")
        PLAN -> KiloBundle.message("history.badge.plan")
        QUESTION -> KiloBundle.message("history.badge.question")
    }

    fun style(): UiStyle.Badge.Style = when (this) {
        RUNNING -> UiStyle.Badge.Alert
        LOGIN_REQUIRED, PERMISSION, PLAN, QUESTION -> UiStyle.Badge.Primary
    }
}
