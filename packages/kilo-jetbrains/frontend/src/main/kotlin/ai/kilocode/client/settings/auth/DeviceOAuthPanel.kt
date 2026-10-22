package ai.kilocode.client.settings.auth

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.RoundedContentPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.icons.AllIcons
import com.intellij.openapi.ide.CopyPasteManager
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
import javax.swing.JPanel
import javax.swing.SwingConstants

internal data class DeviceOAuthInfo(
    val url: String,
    val code: String?,
    val expiresIn: Int,
    val started: Long,
)

internal data class DeviceOAuthText(
    val title: String,
    val qrDescription: String,
)

internal class DeviceOAuthPanel(
    private val copy: DeviceOAuthText,
    private val cancel: () -> Unit,
    private val browse: (String) -> Unit,
    private val prefix: String,
    private val timers: UiTimerSource = UiTimers,
) : JPanel(GridBagLayout()) {
    val urlField = JBTextField().apply {
        isEditable = false
        name = "$prefix.url"
        columns = 30
        addFocusListener(object : FocusAdapter() {
            override fun focusGained(e: FocusEvent) = selectAll()
        })
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) = selectAll()
        })
    }

    val qrLabel = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        name = "$prefix.qr"
        accessibleContext.accessibleName = KiloBundle.message("profile.login.qr")
        accessibleContext.accessibleDescription = copy.qrDescription
    }

    private val openBtn = JButton(KiloBundle.message("profile.login.openBrowser"))
    private val cancelBtn = JButton(KiloBundle.message("profile.login.cancel")).also { it.addActionListener { cancel() } }
    private val copyUrlBtn = HoverIcon().apply {
        icon = AllIcons.Actions.Copy
        toolTipText = KiloBundle.message("profile.login.copyUrl")
    }
    private val codePanel = RoundedContentPanel(UiStyle.Gap.sm(), UiStyle.Gap.md()).apply {
        name = "$prefix.codePanel"
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val c = code ?: return
                copyToClipboard(c, KiloBundle.message("profile.login.codeCopied"), this@DeviceOAuthPanel)
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
    private val waitIcon = AsyncProcessIcon("KiloOAuth")
    private val waitLabel = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
    }
    private var step2: SimpleColoredComponent? = null
    private var code: String? = null
    private var started = 0L
    private var expires = 900
    private var last: String? = null
    private val timer = timers.timer(1000) { syncTime() }

    init {
        border = JBUI.Borders.empty(UiStyle.Gap.pad())
        codePanel.add(codeLabel, BorderLayout.CENTER)
        codePanel.add(codeHint, BorderLayout.SOUTH)
        build()
    }

    private fun build() {
        var row = 0
        add(JBLabel(copy.title).apply {
            font = UiStyle.Fonts.heading()
            horizontalAlignment = SwingConstants.CENTER
        }, gbc(row++))
        add(stepLabel(KiloBundle.message("profile.login.step.one"), KiloBundle.message("profile.login.step.url")), gbc(row++, UiStyle.Gap.md()))
        add(urlRow(), gbc(row++, UiStyle.Gap.sm()))
        add(qrLabel, gbc(row++, UiStyle.Gap.md()).centered())
        val s2 = stepLabel(KiloBundle.message("profile.login.step.two"), KiloBundle.message("profile.login.step.code"))
        step2 = s2
        add(s2, gbc(row++, UiStyle.Gap.md()))
        add(codePanel, gbc(row++, UiStyle.Gap.sm()))
        add(JPanel(FlowLayout(FlowLayout.CENTER, UiStyle.Gap.sm(), 0)).apply {
            isOpaque = false
            add(waitIcon)
            add(waitLabel)
        }, gbc(row++, UiStyle.Gap.xl()))
        add(cancelBtn, gbc(row, UiStyle.Gap.sm()).centered())
    }

    private fun stepLabel(step: String, text: String) = SimpleColoredComponent().apply {
        append(step, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
        append(" $text", SimpleTextAttributes.GRAYED_ATTRIBUTES)
    }

    private fun urlRow(): JPanel {
        val row = JPanel(BorderLayout(UiStyle.Gap.xs(), 0))
        row.add(urlField, BorderLayout.CENTER)
        row.add(JPanel(FlowLayout(FlowLayout.RIGHT, UiStyle.Gap.sm(), 0)).apply {
            isOpaque = false
            add(copyUrlBtn)
            add(openBtn)
        }, BorderLayout.EAST)
        return row
    }

    @RequiresEdt
    fun update(info: DeviceOAuthInfo) {
        code = info.code
        urlField.text = info.url
        urlField.toolTipText = info.url
        if (info.url != last) {
            last = info.url
            openBtn.actionListeners.toList().forEach { openBtn.removeActionListener(it) }
            openBtn.addActionListener { browse(info.url) }
            copyUrlBtn.actionListeners.toList().forEach { copyUrlBtn.removeActionListener(it) }
            copyUrlBtn.addActionListener { copyToClipboard(info.url, KiloBundle.message("profile.login.urlCopied"), copyUrlBtn) }
            qrLabel.icon = try {
                QrCode.icon(info.url, JBUI.scale(160))
            } catch (_: Exception) {
                null
            }
        }
        codePanel.isVisible = info.code != null
        step2?.isVisible = info.code != null
        if (info.code != null) codeLabel.text = spaced(info.code)
        started = info.started
        expires = info.expiresIn
        syncTime()
        waitIcon.resume()
        timer.restart()
    }

    @RequiresEdt
    fun dispose() {
        timer.stop()
        waitIcon.suspend()
        last = null
    }

    @RequiresEdt
    private fun syncTime() {
        val elapsed = ((timers.now() - started) / 1000).toInt()
        val remain = (expires - elapsed).coerceAtLeast(0)
        val min = remain / 60
        val sec = remain % 60
        waitLabel.text = KiloBundle.message("profile.login.waitingTimed", "$min:${sec.toString().padStart(2, '0')}")
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

    private fun spaced(code: String): String = code.map { it.toString() }.joinToString(" ")
}

internal fun copyToClipboard(text: String, msg: String, anchor: java.awt.Component) {
    CopyPasteManager.getInstance().setContents(StringSelection(text))
    if (anchor is javax.swing.JComponent) {
        val point = RelativePoint(anchor, Point(anchor.width / 2, 0))
        JBPopupFactory.getInstance()
            .createHtmlTextBalloonBuilder(msg, null, null, null)
            .createBalloon()
            .show(point, Balloon.Position.above)
    }
}
