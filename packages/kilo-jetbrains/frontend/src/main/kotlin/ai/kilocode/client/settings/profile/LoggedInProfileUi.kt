package ai.kilocode.client.settings.profile

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.RoundedContentPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileKiloPassDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.RelativeFont
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.KeyboardFocusManager
import java.awt.RenderingHints
import java.awt.event.FocusEvent
import java.awt.event.FocusListener
import javax.swing.DefaultComboBoxModel
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants
import kotlin.math.roundToInt

/**
 * Retained logged-in UI. Labels, combo box, and buttons are built once and
 * mutated in [update] — no component rebuilding.
 */
internal class LoggedInProfileUi(
    private val dashboard: () -> Unit,
    private val topUp: () -> Unit,
    private val pass: () -> Unit,
    private val logout: () -> Unit,
    private val organization: (String?) -> Unit,
    private val refresh: () -> Unit,
) : BorderLayoutPanel() {

    companion object {
        private val LOG = KiloLog.create(LoggedInProfileUi::class.java)
    }

    private val nameLabel = JBLabel().also { RelativeFont.BOLD.install(it) }
    private val emailLabel = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        setCopyable(true)
    }
    private val logoLabel = JBLabel(IconLoader.getIcon("/icons/kilo-profile.svg", LoggedInProfileUi::class.java)).apply {
        name = "kilo.profile.logo.loggedIn"
        accessibleContext.accessibleName = KiloBundle.message("settings.kilo.displayName")
    }

    private val titleLabel = JBLabel(KiloBundle.message("profile.balance.title")).apply {
        foreground = UiStyle.Colors.weak()
    }
    private val valueLabel = JBLabel().apply {
        horizontalAlignment = SwingConstants.CENTER
        font = UiStyle.Fonts.display()
    }
    private val refreshBtn = JButton(KiloBundle.message("profile.action.refresh"), AllIcons.Actions.Refresh)
        .also {
            it.isOpaque = false
            it.isContentAreaFilled = false
            it.addActionListener {
                if (refreshing) return@addActionListener
                setRefreshing(true)
                refresh()
            }
        }

    private val passTitleLabel = JBLabel(KiloBundle.message("profile.pass.title")).apply {
        font = UiStyle.Fonts.bold()
    }
    private val passUsageLabel = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        font = UiStyle.Fonts.small()
    }
    private val passBonusLabel = JBLabel(KiloBundle.message("profile.pass.bonusLabel")).apply {
        foreground = UiStyle.Colors.weak()
        font = UiStyle.Fonts.small()
    }
    private val passBonusValue = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        font = UiStyle.Fonts.small()
    }
    private val passRenewLabel = JBLabel(KiloBundle.message("profile.pass.renewsLabel")).apply {
        foreground = UiStyle.Colors.weak()
        font = UiStyle.Fonts.small()
    }
    private val passRenewValue = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
        font = UiStyle.Fonts.small()
    }
    private val passMeter = PassMeter().apply {
        name = "kilo.profile.passMeter"
    }
    private val passBonusRow = Stack.horizontal(UiStyle.Gap.md())
        .next(passBonusLabel)
        .fill(UiStyle.Gap.md())
        .next(passBonusValue)
    private val passRenewRow = Stack.horizontal(UiStyle.Gap.md())
        .next(passRenewLabel)
        .fill(UiStyle.Gap.md())
        .next(passRenewValue)
    private val passLink = ActionLink(KiloBundle.message("profile.pass.subscribe")) {
        pass()
    }.apply {
        name = "kilo.profile.passSubscribe"
    }
    private val passInfo = Stack.vertical(UiStyle.Gap.sm())
        .next(Stack.horizontal(UiStyle.Gap.md())
            .next(passTitleLabel)
            .fill(UiStyle.Gap.md())
            .next(passUsageLabel))
        .next(passMeter)
        .next(passBonusRow)
        .next(passRenewRow)
    private val passPanel = Stack.vertical(UiStyle.Gap.md()).apply {
        name = "kilo.profile.passPanel"
        next(passInfo)
        next(passLink.align(HAlign.LEFT, VAlign.CENTER))
    }

    private val balanceCard = RoundedContentPanel(UiStyle.Gap.pad(), UiStyle.Gap.xl()).apply {
        name = "kilo.profile.balanceCard"
        addToTop(titleLabel)
        addToCenter(Stack.vertical(UiStyle.Gap.pad())
            .next(valueLabel)
            .next(refreshBtn)
            .next(passPanel)
            .align(HAlign.CENTER, VAlign.CENTER))
    }

    private val comboModel = DefaultComboBoxModel<String>()
    val combo = ComboBox(comboModel)

    val dashboardBtn = JButton(KiloBundle.message("profile.action.dashboard"))
        .also { it.addActionListener { dashboard() } }
    val topUpBtn = JButton(KiloBundle.message("profile.action.topUp"))
        .also { it.addActionListener { topUp() } }
    val logoutBtn = JButton(KiloBundle.message("profile.action.logout"))
        .also { it.addActionListener { logout() } }

    private val actionRow = Stack.horizontal(UiStyle.Gap.md())
        .next(dashboardBtn)
        .next(topUpBtn)
        .next(logoutBtn)

    private val header = JPanel(BorderLayout()).apply {
        isOpaque = false
        add(Stack.vertical(UiStyle.Gap.lg())
            .next(nameLabel)
            .next(emailLabel), BorderLayout.CENTER)
        add(logoLabel, BorderLayout.EAST)
    }

    private val content = Stack.vertical(UiStyle.Gap.lg()).apply {
        next(header)
        next(combo)
        next(balanceCard)
        next(actionRow.align(HAlign.CENTER, VAlign.CENTER))
    }

    private var applying = false
    private var refreshing = false
    // Stable identity cache: (orgId or null for personal) to display name.
    // Reflects what is currently shown in the retained combo model.
    private var comboKeys: List<Pair<String?, String>> = emptyList()
    // The orgId that was current as of the last applied profile update.
    private var currentOrgId: String? = null

    init {
        combo.addFocusListener(object : FocusListener {
            override fun focusGained(e: FocusEvent) = logFocus("gained", e)
            override fun focusLost(e: FocusEvent) = logFocus("lost", e)
        })
        combo.addActionListener {
            if (applying) return@addActionListener  // programmatic update — suppress RPC
            val idx = combo.selectedIndex
            if (idx < 0 || idx >= comboKeys.size) return@addActionListener
            val orgId = comboKeys[idx].first
            // currentOrgId reflects the last profile applied by applyOrganizations.
            // applying=true during model/selection changes prevents re-entry here.
            if (orgId == currentOrgId) return@addActionListener
            organization(orgId)
        }
        addToTop(content)
    }

    @RequiresEdt
    fun preferredFocus(): JComponent = if (combo.isVisible) combo else dashboardBtn

    private fun logFocus(kind: String, e: FocusEvent) {
        val edge = if (kind == "lost") "to" else "from"
        val mode = if (e.isTemporary) "temporary" else "permanent"
        val peer = e.oppositeComponent?.let {
            "${it.javaClass.name} name=${it.name ?: "-"} showing=${it.isShowing} visible=${it.isVisible}"
        } ?: "unknown"
        val owner = KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner?.let {
            "${it.javaClass.name} name=${it.name ?: "-"}"
        } ?: "unknown"
        LOG.info(
            "org combo focus $kind [$mode] $edge=$peer owner=$owner " +
                    "popup=${combo.isPopupVisible} selected=${combo.selectedIndex} " +
                    "size=${comboModel.size} visible=${combo.isVisible} showing=${combo.isShowing}",
        )
    }

    @RequiresEdt
    fun update(profile: ProfileDto) {
        val display = profile.name?.takeIf { it.isNotBlank() } ?: profile.email
        if (nameLabel.text != display) nameLabel.text = display

        val showEmail = profile.name != null
        if (emailLabel.isVisible != showEmail) emailLabel.isVisible = showEmail
        if (showEmail && emailLabel.text != profile.email) emailLabel.text = profile.email

        val bal = profile.balance
        val personal = profile.currentOrgId == null
        val item = if (personal) profile.kiloPass else null
        val showPass = personal && (bal != null || item != null)
        var changed = false
        changed = visible(titleLabel, bal != null) || changed
        changed = visible(valueLabel, bal != null) || changed
        changed = visible(refreshBtn, bal != null || showPass) || changed
        if (bal != null) {
            val balText = formatBalance(bal.balance)
            if (valueLabel.text != balText) {
                valueLabel.text = balText
                changed = true
            }
        }
        changed = syncPass(item, showPass) || changed
        changed = visible(balanceCard, bal != null || showPass) || changed

        applyOrganizations(profile)
        if (changed) syncLayout()
    }

    @RequiresEdt
    private fun syncPass(item: ProfileKiloPassDto?, show: Boolean): Boolean {
        var changed = false
        val info = show && item != null
        if (passInfo.isVisible != info) {
            passInfo.isVisible = info
            changed = true
        }
        if (item != null) {
            val usage = KiloBundle.message(
                "profile.pass.used",
                formatShortBalance(item.currentPeriodUsageUsd),
                formatShortBalance(item.currentPeriodBaseCreditsUsd),
            )
            if (passUsageLabel.text != usage) {
                passUsageLabel.text = usage
                changed = true
            }
            val base = item.currentPeriodBaseCreditsUsd.coerceAtLeast(1.0)
            passMeter.setFraction(item.currentPeriodUsageUsd / base)
            val bonus = if (item.currentPeriodBonusCreditsUsd > 0.0) {
                "+${formatBalance(item.currentPeriodBonusCreditsUsd)}"
            } else null
            if (passBonusValue.text != bonus.orEmpty()) {
                passBonusValue.text = bonus.orEmpty()
                changed = true
            }
            val bonusVisible = bonus != null
            if (passBonusRow.isVisible != bonusVisible) {
                passBonusRow.isVisible = bonusVisible
                changed = true
            }
            val reset = formatResetDate(item.nextBillingAt)
            if (passRenewValue.text != reset.orEmpty()) {
                passRenewValue.text = reset.orEmpty()
                changed = true
            }
            val renewVisible = reset != null
            if (passRenewRow.isVisible != renewVisible) {
                passRenewRow.isVisible = renewVisible
                changed = true
            }
        }
        val link = show && item == null
        if (passLink.isVisible != link) {
            passLink.isVisible = link
            changed = true
        }
        val panel = info || link
        if (passPanel.isVisible != panel) {
            passPanel.isVisible = panel
            changed = true
        }
        return changed
    }

    @RequiresEdt
    private fun visible(component: JComponent, show: Boolean): Boolean {
        if (component.isVisible == show) return false
        component.isVisible = show
        return true
    }

    @RequiresEdt
    fun setRefreshing(refreshing: Boolean) {
        if (this.refreshing == refreshing) return
        this.refreshing = refreshing
        val text = if (refreshing) KiloBundle.message("profile.action.refreshing")
        else KiloBundle.message("profile.action.refresh")
        if (refreshBtn.text != text) refreshBtn.text = text
        syncLayout()
    }

    @RequiresEdt
    private fun syncLayout() {
        balanceCard.revalidate()
        content.revalidate()
        revalidate()
        repaint()
    }

    @RequiresEdt
    private fun applyOrganizations(profile: ProfileDto) {
        val orgs = profile.organizations
        val personal = profile.hasPersonalAccount
        val keys: List<Pair<String?, String>> = (if (personal) listOf(null to KiloBundle.message("profile.personalAccount")) else emptyList()) +
                orgs.map { it.id to it.name }

        val target = keys.indexOfFirst { it.first == profile.currentOrgId }.takeIf { it >= 0 } ?: 0

        currentOrgId = profile.currentOrgId

        applying = true
        try {
            if (keys != comboKeys) {
                comboKeys = keys
                syncModel(keys)
            }
            if (combo.selectedIndex != target) combo.selectedIndex = target
        } finally {
            applying = false
        }

        val show = orgs.isNotEmpty()
        if (combo.isVisible != show) {
            combo.isVisible = show
            syncLayout()
        }
    }

    /**
     * Reconcile [comboModel] with [keys] in place — never empties the model.
     *
     * - Trim excess elements from the tail (avoids transient empty state).
     * - Update or append each position by name.
     * This keeps the model always non-empty during changes, preserving popup/focus state.
     */
    @RequiresEdt
    private fun syncModel(keys: List<Pair<String?, String>>) {
        if (comboModel.size == 0) {
            keys.forEach { comboModel.addElement(it.second) }
            return
        }
        // Remove excess from the end first so indices stay stable during updates below.
        while (comboModel.size > keys.size) {
            comboModel.removeElementAt(comboModel.size - 1)
        }
        keys.forEachIndexed { i, (_, name) ->
            if (i >= comboModel.size) {
                comboModel.addElement(name)
            } else if (comboModel.getElementAt(i) != name) {
                // Insert new name before the stale one, then remove stale — never leaves a gap.
                comboModel.insertElementAt(name, i)
                comboModel.removeElementAt(i + 1)
            }
        }
    }

    private class PassMeter : JComponent() {
        private var fraction = 0.0

        @RequiresEdt
        fun setFraction(value: Double) {
            val next = value.coerceIn(0.0, 1.0)
            if (fraction == next) return
            fraction = next
            repaint()
        }

        override fun getPreferredSize() = JBUI.size(160, 6)

        override fun paintComponent(g: Graphics) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                val arc = JBUI.scale(6)
                g2.color = UiStyle.Colors.contentBorder()
                g2.fillRoundRect(0, 0, width, height, arc, arc)
                val fill = (width * fraction).roundToInt()
                if (fill <= 0) return
                g2.color = JBUI.CurrentTheme.Link.Foreground.ENABLED
                g2.fillRoundRect(0, 0, fill, height, arc, arc)
            } finally {
                g2.dispose()
            }
        }
    }
}
