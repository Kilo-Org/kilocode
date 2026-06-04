package ai.kilocode.client.settings.profile

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.RoundedContentPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.AsyncProcessIcon
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.FlowLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Point
import java.awt.datatransfer.StringSelection
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants
import javax.swing.Timer

internal enum class OutMode { CONNECTING, APP_ERROR, INITIATING, AUTH, LOGIN_ERROR, EMPTY }

/**
 * Retained logged-out UI. Internally uses a [CardLayout] to switch between
 * connecting, error, device-auth, initiating, login-error, and not-logged-in states
 * without rebuilding components on every state change.
 */
internal class LoggedOutProfileUi(
    private val login: () -> Unit,
    private val retry: () -> Unit,
    private val cancel: () -> Unit,
    private val browse: (String) -> Unit,
) : JPanel(BorderLayout()) {

    private val cards = JPanel(CardLayout())
    private val cardLayout = cards.layout as CardLayout
    private var mode: OutMode? = null

    // -- retained buttons --
    val loginBtn = JButton(KiloBundle.message("profile.action.login"))
        .also { it.addActionListener { login() } }

    private val retryBtnConnecting = JButton(KiloBundle.message("profile.action.retry"))
        .also { it.addActionListener { retry() } }

    private val retryBtnError = JButton(KiloBundle.message("profile.action.retry"))
        .also { it.addActionListener { retry() } }

    private val authRetryBtn = JButton(KiloBundle.message("profile.login.tryAgain"))
        .also { it.addActionListener { login() } }

    private val cancelBtn = JButton(KiloBundle.message("profile.login.cancel"))
        .also { it.addActionListener { cancel() } }

    private val openBtn = JButton(KiloBundle.message("profile.login.openBrowser"))

    private val copyUrlBtn = HoverIcon().apply {
        icon = AllIcons.Actions.Copy
        toolTipText = KiloBundle.message("profile.login.copyUrl")
    }

    // -- retained auth card components --
    val urlField = JBTextField().apply {
        isEditable = false
        name = "kilo.login.url"
        columns = 30
        // Select all on focus so clicking the field selects the whole URL
        addFocusListener(object : FocusAdapter() {
            override fun focusGained(e: FocusEvent) = selectAll()
        })
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) = selectAll()
        })
    }

    val qrLabel = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        name = "kilo.login.qr"
        accessibleContext.accessibleName = KiloBundle.message("profile.login.qr")
        accessibleContext.accessibleDescription = KiloBundle.message("profile.login.qr.description")
    }

    private val codePanel = RoundedContentPanel(UiStyle.Gap.sm(), UiStyle.Gap.md()).apply {
        name = "kilo.login.codePanel"
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val c = rawCode ?: return
                copyToClipboard(c, KiloBundle.message("profile.login.codeCopied"), this@LoggedOutProfileUi)
            }
        })
    }

    private val codeLabel = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        font = UiStyle.Fonts.large()
    }

    private val codeHint = JBLabel(KiloBundle.message("profile.login.clickToCopy")).apply {
        foreground = UiStyle.Colors.weak()
        horizontalAlignment = SwingConstants.CENTER
    }

    private val initiatingIcon = AsyncProcessIcon("KiloInitiating").also { it.suspend() }

    private val waitIcon = AsyncProcessIcon("KiloLogin")

    private val waitLabel = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
    }

    private val logoLabel = JBLabel(IconLoader.getIcon("/icons/kilo-profile.svg", LoggedOutProfileUi::class.java)).apply {
        name = "kilo.profile.logo.loggedOut"
        horizontalAlignment = SwingConstants.CENTER
        accessibleContext.accessibleName = KiloBundle.message("settings.kilo.displayName")
    }

    private val errLabel = JBLabel().apply {
        foreground = UiStyle.Colors.errorLabelForeground()
        horizontalAlignment = SwingConstants.CENTER
    }

    // -- step 2 label reference for visibility toggling --
    private var step2Label: SimpleColoredComponent? = null

    // -- countdown state --
    private var rawCode: String? = null
    private var pendingStarted = 0L
    private var pendingExpires = 900

    // -- cached URL for listener/QR deduplication --
    private var lastPendingUrl: String? = null

    private val timer = Timer(1000) { syncTime() }

    init {
        codePanel.add(codeLabel, BorderLayout.CENTER)
        codePanel.add(codeHint, BorderLayout.SOUTH)

        cards.add(connectingCard(), OutMode.CONNECTING.name)
        cards.add(appErrorCard(), OutMode.APP_ERROR.name)
        cards.add(emptyCard(), OutMode.EMPTY.name)
        cards.add(initiatingCard(), OutMode.INITIATING.name)
        cards.add(authCard(), OutMode.AUTH.name)
        cards.add(loginErrorCard(), OutMode.LOGIN_ERROR.name)
        add(cards, BorderLayout.NORTH)
    }

    // ---- card builders (called once in init) ----

    private fun connectingCard(): JPanel {
        val p = padded()
        p.add(JBLabel(KiloBundle.message("profile.status.connecting")).apply {
            foreground = UiStyle.Colors.weak()
            horizontalAlignment = SwingConstants.CENTER
        }, gbc(0))
        p.add(retryBtnConnecting, gbc(1, UiStyle.Gap.sm()).centered())
        return p
    }

    private fun appErrorCard(): JPanel {
        val p = padded()
        p.add(JBLabel(KiloBundle.message("profile.status.error")).apply {
            foreground = UiStyle.Colors.errorLabelForeground()
            horizontalAlignment = SwingConstants.CENTER
        }, gbc(0))
        p.add(retryBtnError, gbc(1, UiStyle.Gap.sm()).centered())
        return p
    }

    private fun emptyCard(): JPanel {
        val p = padded()
        p.add(logoLabel, gbc(0).centered())
        p.add(JBLabel(KiloBundle.message("profile.notLoggedIn")).apply {
            foreground = UiStyle.Colors.weak()
            horizontalAlignment = SwingConstants.CENTER
        }, gbc(1, UiStyle.Gap.pad()))
        p.add(loginBtn, gbc(2, UiStyle.Gap.sm()).centered())
        return p
    }

    private fun initiatingCard(): JPanel {
        val p = padded()
        val row = JPanel(FlowLayout(FlowLayout.CENTER, UiStyle.Gap.sm(), 0)).apply {
            isOpaque = false
            add(initiatingIcon)
            add(JBLabel(KiloBundle.message("profile.login.starting")).apply {
                foreground = UiStyle.Colors.weak()
            })
        }
        p.add(row, gbc(0).centered())
        return p
    }

    private fun authCard(): JPanel {
        val p = padded()
        var row = 0

        p.add(JBLabel(KiloBundle.message("profile.login.title")).apply {
            font = UiStyle.Fonts.heading()
            horizontalAlignment = SwingConstants.CENTER
        }, gbc(row++))

        p.add(stepLabel(KiloBundle.message("profile.login.step.one"), KiloBundle.message("profile.login.step.url")),
            gbc(row++, UiStyle.Gap.md()))

        p.add(urlRow(), gbc(row++, UiStyle.Gap.sm()))

        p.add(qrLabel, gbc(row++, UiStyle.Gap.md()).centered())

        val s2 = stepLabel(KiloBundle.message("profile.login.step.two"), KiloBundle.message("profile.login.step.code"))
        step2Label = s2
        p.add(s2, gbc(row++, UiStyle.Gap.md()))

        p.add(codePanel, gbc(row++, UiStyle.Gap.sm()))

        val waitRow = JPanel(FlowLayout(FlowLayout.CENTER, UiStyle.Gap.sm(), 0)).apply {
            isOpaque = false
            add(waitIcon)
            add(waitLabel)
        }
        p.add(waitRow, gbc(row++, UiStyle.Gap.xl()))

        p.add(cancelBtn, gbc(row, UiStyle.Gap.sm()).centered())

        return p
    }

    private fun stepLabel(step: String, text: String) = SimpleColoredComponent().apply {
        append(step, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
        append(" $text", SimpleTextAttributes.GRAYED_ATTRIBUTES)
    }

    private fun urlRow(): JPanel {
        val row = JPanel(BorderLayout(UiStyle.Gap.xs(), 0))
        row.add(urlField, BorderLayout.CENTER)
        val btns = JPanel(FlowLayout(FlowLayout.RIGHT, UiStyle.Gap.sm(), 0)).apply {
            isOpaque = false
            add(copyUrlBtn)
            add(openBtn)
        }
        row.add(btns, BorderLayout.EAST)
        return row
    }

    private fun loginErrorCard(): JPanel {
        val p = padded()
        p.add(errLabel, gbc(0))
        p.add(authRetryBtn, gbc(1, UiStyle.Gap.sm()).centered())
        return p
    }

    // ---- update ----

    @RequiresEdt
    fun update(status: KiloAppStatusDto, login: LoginState) {
        val target = resolveMode(status, login)

        if (target == OutMode.AUTH && login is LoginState.Pending) {
            val auth = login.auth
            val url = auth.verificationUrl
            val code = auth.code

            rawCode = code
            urlField.text = url
            urlField.toolTipText = url

            // Wire listeners and generate QR only when URL changes (avoids re-wiring on every re-sync)
            if (url != lastPendingUrl) {
                lastPendingUrl = url

                openBtn.actionListeners.toList().forEach { openBtn.removeActionListener(it) }
                openBtn.addActionListener { browse(url) }
                copyUrlBtn.actionListeners.toList().forEach { copyUrlBtn.removeActionListener(it) }
                copyUrlBtn.addActionListener {
                    copyToClipboard(url, KiloBundle.message("profile.login.urlCopied"), copyUrlBtn)
                }

                // QR code — expensive; only regenerate when URL changes
                try {
                    qrLabel.icon = QrCode.icon(url, JBUI.scale(160))
                } catch (_: Exception) {
                    qrLabel.icon = null
                }
            }

            // Code display
            codePanel.isVisible = code != null
            step2Label?.isVisible = code != null
            if (code != null) {
                codeLabel.text = spacedCode(code)
            }

            // Countdown: only reset when entering auth for the first time for this pending
            if (mode != OutMode.AUTH) {
                pendingStarted = login.started
                pendingExpires = auth.expiresIn
                syncTime()
                timer.restart()
            }
        }

        if (target == OutMode.LOGIN_ERROR && login is LoginState.Error) {
            errLabel.text = login.message
        }

        if (mode != target) {
            if (mode == OutMode.AUTH) {
                timer.stop()
                waitIcon.suspend()
                lastPendingUrl = null
            }
            if (mode == OutMode.INITIATING) initiatingIcon.suspend()
            cardLayout.show(cards, target.name)
            mode = target
            if (target == OutMode.AUTH) {
                waitIcon.resume()
            }
            if (target == OutMode.INITIATING) initiatingIcon.resume()
            revalidate()
            repaint()
        }
    }

    @RequiresEdt
    fun preferredFocus(): JComponent = loginBtn

    /** Stop the timer and suspend all animated icons. Safe to call multiple times. */
    @RequiresEdt
    fun dispose() {
        timer.stop()
        waitIcon.suspend()
        initiatingIcon.suspend()
        lastPendingUrl = null
    }

    private fun resolveMode(status: KiloAppStatusDto, login: LoginState): OutMode = when {
        status == KiloAppStatusDto.DISCONNECTED || status == KiloAppStatusDto.CONNECTING || status == KiloAppStatusDto.MIGRATION_REQUIRED -> OutMode.CONNECTING
        status == KiloAppStatusDto.ERROR -> OutMode.APP_ERROR
        login is LoginState.Initiating -> OutMode.INITIATING
        login is LoginState.Pending -> OutMode.AUTH
        login is LoginState.Error -> OutMode.LOGIN_ERROR
        else -> OutMode.EMPTY
    }

    @RequiresEdt
    private fun syncTime() {
        val elapsed = ((System.currentTimeMillis() - pendingStarted) / 1000).toInt()
        val remain = (pendingExpires - elapsed).coerceAtLeast(0)
        val min = remain / 60
        val sec = remain % 60
        waitLabel.text = KiloBundle.message("profile.login.waitingTimed", "$min:${sec.toString().padStart(2, '0')}")
    }

    // ---- helpers ----

    private fun padded() = JPanel(GridBagLayout()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.pad())
    }

    private fun gbc(y: Int, top: Int = 0) = GridBagConstraints().apply {
        gridx = 0
        gridy = y
        weightx = 1.0
        fill = GridBagConstraints.HORIZONTAL
        insets = JBUI.insetsTop(top)
    }

    private fun GridBagConstraints.centered(): GridBagConstraints = apply {
        fill = GridBagConstraints.NONE
        anchor = GridBagConstraints.CENTER
    }

    private fun spacedCode(code: String): String = code.map { it.toString() }.joinToString(" ")
}

/** Copy [text] to the platform clipboard and show a brief confirmation balloon anchored to [anchor]. */
private fun copyToClipboard(text: String, msg: String, anchor: java.awt.Component) {
    CopyPasteManager.getInstance().setContents(StringSelection(text))
    if (anchor is javax.swing.JComponent) {
        val point = RelativePoint(anchor, Point(anchor.width / 2, 0))
        JBPopupFactory.getInstance()
            .createHtmlTextBalloonBuilder(msg, null, null, null)
            .createBalloon()
            .show(point, Balloon.Position.above)
    }
}
