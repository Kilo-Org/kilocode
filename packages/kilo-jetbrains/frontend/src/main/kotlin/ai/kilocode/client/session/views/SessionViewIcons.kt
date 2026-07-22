package ai.kilocode.client.session.views

import com.intellij.openapi.util.IconLoader
import javax.swing.Icon

object SessionViewIcons {
    val brain = icon("brain")
    val bubble = icon("bubble-5")
    val bulletList = icon("bullet-list")
    val checklist = icon("checklist")
    val chevronDown: Icon = icon("chevron-down")
    val chevronLeft = icon("chevron-left")
    val chevronRight = icon("chevron-right")
    val chevronCollapsed: Icon = chevronRight
    val chevronExpanded: Icon = chevronDown
    val code = icon("code")
    val codeLines = icon("code-lines")
    val console = icon("console")
    val eye = icon("eye")
    val glasses = icon("glasses")
    val mcp = icon("mcp")
    val ruleApprove = icon("check-small")
    val ruleApproveActive = icon("check-small-active")
    val ruleDeny = icon("close-small")
    val ruleDenyActive = icon("close-small-active")
    val search = icon("magnifying-glass-menu")
    val task = icon("task")
    val warning = icon("warning")
    val windowCursor = icon("window-cursor")

    private fun icon(name: String) = IconLoader.getIcon("/icons/views/$name.svg", SessionViewIcons::class.java)
}
