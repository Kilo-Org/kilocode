package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionController
import ai.kilocode.client.session.SessionControllerEvent
import ai.kilocode.client.session.SessionControllerListener
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Font
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.Icon
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * Welcome panel showing app + workspace initialization progress.
 *
 * Pure view — listens to [SessionController] events and reads
 * [SessionModel][ai.kilocode.client.session.model.SessionModel] for data.
 * No coroutines, no service references.
 *
 * Uses icon+label rows for each resource being loaded. Icons act as
 * status indicators: animated spinner for loading, green check for
 * success, red circle for error, grey circle for idle.
 */
class StatusPanel(
    parent: Disposable,
    private val controller: SessionController,
) : JPanel(GridBagLayout()), SessionControllerListener, Disposable {

    init {
        Disposer.register(parent, this)
    }

    // ------ status icons ------

    private val iconLoading: Icon = AnimatedIcon.Default()
    private val iconOk: Icon = AllIcons.RunConfigurations.TestPassed
    private val iconError: Icon = AllIcons.RunConfigurations.TestFailed
    private val iconWarn: Icon = AllIcons.General.Warning
    private val iconIdle: Icon = AllIcons.RunConfigurations.TestNotRan

    // ------ header ------

    private val logo = JBLabel(
        IconLoader.getIcon("/icons/kilo-content.svg", StatusPanel::class.java),
    ).apply {
        alignmentX = CENTER_ALIGNMENT
    }

    private val status = JBLabel().apply {
        alignmentX = CENTER_ALIGNMENT
        horizontalAlignment = SwingConstants.CENTER
        font = JBUI.Fonts.label(13f)
        foreground = UIUtil.getLabelForeground()
    }

    // ------ app rows ------

    private val configRow = row(KiloBundle.message("toolwindow.row.config"))
    private val notifRow = row(KiloBundle.message("toolwindow.row.notifications"))
    private val profileRow = row(KiloBundle.message("toolwindow.row.profile"))

    // ------ workspace rows ------

    private val providersRow = row(KiloBundle.message("toolwindow.row.providers"))
    private val agentsRow = row(KiloBundle.message("toolwindow.row.agents"))
    private val commandsRow = row(KiloBundle.message("toolwindow.row.commands"))
    private val skillsRow = row(KiloBundle.message("toolwindow.row.skills"))

    // ------ section headers ------

    private val appHeader = header(KiloBundle.message("toolwindow.section.app"))
    private val wsHeader = header(KiloBundle.message("toolwindow.section.workspace"))

    private val appSection = section(appHeader, configRow, notifRow, profileRow)
    private val wsSection = section(wsHeader, providersRow, agentsRow, commandsRow, skillsRow)

    init {
        isOpaque = false

        val body = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            border = JBUI.Borders.empty(12, 16)

            add(logo)
            add(Box.createVerticalStrut(JBUI.scale(12)))
            add(status)
            add(Box.createVerticalStrut(JBUI.scale(12)))
            add(appSection)
            add(Box.createVerticalStrut(JBUI.scale(12)))
            add(wsSection)
        }

        add(body, GridBagConstraints())

        resetAll()
        controller.addListener(this, this)
    }

    override fun onEvent(event: SessionControllerEvent) {
        when (event) {
            is SessionControllerEvent.AppChanged -> {
                renderApp(controller.model.app)
                revalidate()
                repaint()
            }

            is SessionControllerEvent.WorkspaceChanged -> {
                renderWorkspace(controller.model.workspace)
                revalidate()
                repaint()
            }

            else -> {}
        }
    }

    // ------ rendering ------

    private fun renderApp(state: KiloAppStateDto) {
        status.text = title(state)

        when (state.status) {
            KiloAppStatusDto.DISCONNECTED -> {
                resetAll()
            }
            KiloAppStatusDto.CONNECTING -> {
                configRow.loading()
                notifRow.loading()
                profileRow.loading()
            }
            KiloAppStatusDto.LOADING -> {
                val p = state.progress
                if (p != null) {
                    if (p.config) configRow.ok(KiloBundle.message("toolwindow.row.config")) else configRow.loading()
                    if (p.notifications) notifRow.ok(KiloBundle.message("toolwindow.row.notifications")) else notifRow.loading()
                    renderProfile(p.profile)
                }
            }
            KiloAppStatusDto.READY -> {
                val p = state.progress
                if (p != null) {
                    configRow.ok(KiloBundle.message("toolwindow.row.config"))
                    notifRow.ok(KiloBundle.message("toolwindow.row.notifications"))
                    renderProfile(p.profile)
                } else {
                    configRow.ok(KiloBundle.message("toolwindow.row.config"))
                    notifRow.ok(KiloBundle.message("toolwindow.row.notifications"))
                    profileRow.ok(KiloBundle.message("toolwindow.profile.loggedin"))
                }
            }
            KiloAppStatusDto.ERROR -> {
                val errors = state.errors.associate { it.resource to it }
                configRow.apply {
                    val detail = errors["config"]?.detail ?: KiloBundle.message("toolwindow.error.failed")
                    if ("config" in errors) error(KiloBundle.message("toolwindow.error.config", detail))
                    else ok(KiloBundle.message("toolwindow.row.config"))
                }
                notifRow.apply {
                    val detail = errors["notifications"]?.detail ?: KiloBundle.message("toolwindow.error.failed")
                    if ("notifications" in errors) error(KiloBundle.message("toolwindow.error.notifications", detail))
                    else ok(KiloBundle.message("toolwindow.row.notifications"))
                }
                profileRow.apply {
                    val detail = errors["profile"]?.detail ?: KiloBundle.message("toolwindow.error.failed")
                    if ("profile" in errors) error(KiloBundle.message("toolwindow.error.profile", detail))
                    else ok(KiloBundle.message("toolwindow.profile.loggedin"))
                }
            }
        }
    }

    private fun renderWorkspace(state: KiloWorkspaceStateDto) {
        val appReady = controller.model.app.status == KiloAppStatusDto.READY
        val visible = appReady || state.status != KiloWorkspaceStatusDto.PENDING
        wsSection.isVisible = visible
        if (!visible) return

        when (state.status) {
            KiloWorkspaceStatusDto.PENDING -> {
                providersRow.idle(KiloBundle.message("toolwindow.row.providers"))
                agentsRow.idle(KiloBundle.message("toolwindow.row.agents"))
                commandsRow.idle(KiloBundle.message("toolwindow.row.commands"))
                skillsRow.idle(KiloBundle.message("toolwindow.row.skills"))
            }
            KiloWorkspaceStatusDto.LOADING -> {
                val p = state.progress
                if (p != null) {
                    if (p.providers) providersRow.ok(KiloBundle.message("toolwindow.row.providers")) else providersRow.loading()
                    if (p.agents) agentsRow.ok(KiloBundle.message("toolwindow.row.agents")) else agentsRow.loading()
                    if (p.commands) commandsRow.ok(KiloBundle.message("toolwindow.row.commands")) else commandsRow.loading()
                    if (p.skills) skillsRow.ok(KiloBundle.message("toolwindow.row.skills")) else skillsRow.loading()
                } else {
                    providersRow.loading()
                    agentsRow.loading()
                    commandsRow.loading()
                    skillsRow.loading()
                }
            }
            KiloWorkspaceStatusDto.READY -> {
                val prov = state.providers?.providers?.size ?: 0
                val ag = state.agents?.all?.size ?: 0
                val cmd = state.commands.size
                val sk = state.skills.size
                providersRow.ok(KiloBundle.message("toolwindow.row.providers.count", prov))
                agentsRow.ok(KiloBundle.message("toolwindow.row.agents.count", ag))
                commandsRow.ok(KiloBundle.message("toolwindow.row.commands.count", cmd))
                skillsRow.ok(KiloBundle.message("toolwindow.row.skills.count", sk))
            }
            KiloWorkspaceStatusDto.ERROR -> {
                val msg = state.error ?: KiloBundle.message("toolwindow.error.unknown")
                providersRow.error(msg)
                agentsRow.idle(KiloBundle.message("toolwindow.row.agents"))
                commandsRow.idle(KiloBundle.message("toolwindow.row.commands"))
                skillsRow.idle(KiloBundle.message("toolwindow.row.skills"))
            }
        }
    }

    // ------ helpers ------

    private fun title(state: KiloAppStateDto): String =
        when (state.status) {
            KiloAppStatusDto.DISCONNECTED -> KiloBundle.message("toolwindow.status.disconnected")
            KiloAppStatusDto.CONNECTING -> KiloBundle.message("toolwindow.status.connecting")
            KiloAppStatusDto.LOADING -> KiloBundle.message("toolwindow.status.loading")
            KiloAppStatusDto.READY -> {
                val ver = controller.model.version
                if (ver != null) KiloBundle.message("toolwindow.status.connected.version", ver)
                else KiloBundle.message("toolwindow.status.connected")
            }
            KiloAppStatusDto.ERROR -> KiloBundle.message(
                "toolwindow.status.error",
                state.error ?: KiloBundle.message("toolwindow.error.unknown"),
            )
        }

    private fun renderProfile(profile: ProfileStatusDto) {
        when (profile) {
            ProfileStatusDto.LOADED -> profileRow.ok(KiloBundle.message("toolwindow.profile.loggedin"))
            ProfileStatusDto.NOT_LOGGED_IN -> profileRow.warn(KiloBundle.message("toolwindow.profile.notloggedin"))
            ProfileStatusDto.PENDING -> profileRow.loading(KiloBundle.message("toolwindow.row.profile"))
        }
    }

    private fun resetAll() {
        configRow.idle(KiloBundle.message("toolwindow.row.config"))
        notifRow.idle(KiloBundle.message("toolwindow.row.notifications"))
        profileRow.idle(KiloBundle.message("toolwindow.row.profile"))
        providersRow.idle(KiloBundle.message("toolwindow.row.providers"))
        agentsRow.idle(KiloBundle.message("toolwindow.row.agents"))
        commandsRow.idle(KiloBundle.message("toolwindow.row.commands"))
        skillsRow.idle(KiloBundle.message("toolwindow.row.skills"))
    }

    // ------ row factory ------

    private fun row(text: String): StatusRow = StatusRow(text, iconIdle)

    private fun header(text: String): JBLabel = JBLabel(text).apply {
        alignmentX = LEFT_ALIGNMENT
        font = JBUI.Fonts.label().deriveFont(JBUI.Fonts.label().style or Font.BOLD)
        foreground = UIUtil.getLabelForeground()
        border = JBUI.Borders.empty(0, 0, 4, 0)
    }

    private fun section(hdr: JBLabel, vararg rows: StatusRow): JPanel = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        alignmentX = CENTER_ALIGNMENT
        add(hdr)
        for (r in rows) add(r.label)
    }

    inner class StatusRow(text: String, icon: Icon) {
        val label = JBLabel(text, icon, SwingConstants.LEFT).apply {
            font = JBUI.Fonts.label()
            foreground = UIUtil.getContextHelpForeground()
            iconTextGap = JBUI.scale(6)
            border = JBUI.Borders.empty(2, 0)
            alignmentX = LEFT_ALIGNMENT
        }

        fun ok(msg: String, ic: Icon = iconOk) {
            label.icon = ic
            label.text = msg
            label.foreground = UIUtil.getContextHelpForeground()
        }

        fun loading(msg: String = label.text) {
            label.icon = iconLoading
            label.text = msg
            label.foreground = UIUtil.getContextHelpForeground()
        }

        fun warn(msg: String) {
            label.icon = iconWarn
            label.text = msg
            label.foreground = UIUtil.getContextHelpForeground()
        }

        fun error(msg: String) {
            label.icon = iconError
            label.text = msg
            label.foreground = UIUtil.getErrorForeground()
        }

        fun idle(msg: String) {
            label.icon = iconIdle
            label.text = msg
            label.foreground = UIUtil.getContextHelpForeground()
        }
    }

    override fun dispose() {
        // Listener auto-removed by Disposer (registered in init via addListener)
    }
}
