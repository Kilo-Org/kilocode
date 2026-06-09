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
import com.intellij.icons.AllIcons
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.RelativeFont
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.KeyboardFocusManager
import java.awt.event.FocusEvent
import java.awt.event.FocusListener
import javax.swing.DefaultComboBoxModel
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants
import java.awt.BorderLayout

/**
 * Retained logged-in UI. Labels, combo box, and buttons are built once and
 * mutated in [update] — no component rebuilding.
 */
internal class LoggedInProfileUi(
    private val dashboard: () -> Unit,
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

    private val balanceCard = RoundedContentPanel(UiStyle.Gap.pad(), UiStyle.Gap.xl()).apply {
        name = "kilo.profile.balanceCard"
        addToTop(titleLabel)
        addToCenter(Stack.vertical(UiStyle.Gap.pad())
            .next(valueLabel)
            .next(refreshBtn)
            .align(HAlign.CENTER, VAlign.CENTER))
    }

    private val comboModel = DefaultComboBoxModel<String>()
    val combo = ComboBox(comboModel)

    val dashboardBtn = JButton(KiloBundle.message("profile.action.dashboard"))
        .also { it.addActionListener { dashboard() } }
    val logoutBtn = JButton(KiloBundle.message("profile.action.logout"))
        .also { it.addActionListener { logout() } }

    private val actionRow = Stack.horizontal(UiStyle.Gap.md())
        .next(dashboardBtn)
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
        var changed = false
        if (bal != null) {
            val balText = formatBalance(bal.balance)
            if (valueLabel.text != balText) {
                valueLabel.text = balText
                changed = true
            }
            if (!balanceCard.isVisible) {
                balanceCard.isVisible = true
                changed = true
            }
        } else {
            if (balanceCard.isVisible) {
                balanceCard.isVisible = false
                changed = true
            }
        }

        applyOrganizations(profile)
        if (changed) syncLayout()
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
        val keys: List<Pair<String?, String>> = listOf(null to KiloBundle.message("profile.personalAccount")) +
                orgs.map { it.id to it.name }

        val target = profile.currentOrgId
            ?.let { id -> orgs.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.plus(1) }
            ?: 0

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
}
