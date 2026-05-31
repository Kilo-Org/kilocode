package ai.kilocode.client.session

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import java.awt.Color

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

    fun bg(): Color = when (this) {
        RUNNING -> UiStyle.Colors.runningBadgeBg()
        LOGIN_REQUIRED, PERMISSION, PLAN, QUESTION -> UiStyle.Colors.activityBadgeBg()
    }

    fun fg(): Color = when (this) {
        RUNNING -> UiStyle.Colors.runningBadgeFg()
        LOGIN_REQUIRED, PERMISSION, PLAN, QUESTION -> UiStyle.Colors.activityBadgeFg()
    }
}
