package ai.kilocode.client.session.ui.account

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.PickerButton
import ai.kilocode.client.ui.RoundedContentPanel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.icons.AllIcons
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.CollectionListModel
import com.intellij.ui.ListUtil
import com.intellij.ui.ScrollPaneFactory
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import ai.kilocode.client.settings.profile.formatBalance
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Cursor
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.ScrollPaneConstants

/**
 * Compact account overlay shown in the top-right of the empty session screen.
 *
 * Only visible when logged in. Hidden when not logged in or no profile is available.
 * Visibility is controlled entirely by [onEvent] — never set [isVisible] externally.
 */
internal class SessionAccountOverlay(
    private val select: (String?) -> Unit,
    private val profile: () -> Unit,
) : BorderLayoutPanel() {

    private val picker = PickerButton().apply {
        isEnabled = false
        text = " "
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!isEnabled || choices.isEmpty()) return
                showPopup()
            }
        })
    }

    private var balanceText: String? = null

    private val balance = JBLabel().apply {
        isVisible = false
    }

    private val profileBtn = HoverIcon().apply {
        icon = AllIcons.General.User
        toolTipText = KiloBundle.message("action.Kilo.ShowProfile.description")
        accessibleContext.accessibleName = KiloBundle.message("action.Kilo.ShowProfile.text")
        addActionListener { profile() }
    }

    private val row = Stack.horizontal(gap = UiStyle.Gap.md())
        .next(picker)
        .next(balance)
        .next(profileBtn)

    private val panel = RoundedContentPanel(UiStyle.Gap.lg(), UiStyle.Gap.lg()).apply {
        addToCenter(row)
    }

    private var choices: List<AccountChoice> = emptyList()
    private var currentOrgId: String? = null

    init {
        isOpaque = false
        isVisible = false
        addToCenter(panel)
    }

    @RequiresEdt
    fun onEvent(event: SessionControllerEvent.AccountOverlayChanged) {
        var layout = false
        var paint = false
        when (event) {
            is SessionControllerEvent.AccountOverlayChanged.Hide -> {
                if (isVisible) {
                    isVisible = false
                    layout = true
                    paint = true
                }
            }
            is SessionControllerEvent.AccountOverlayChanged.Show -> {
                val snap = event.account
                val prof = snap.profile
                if (prof == null) {
                    if (!snap.transient && isVisible) {
                        isVisible = false
                        layout = true
                        paint = true
                    }
                } else {
                    layout = updateLoggedIn(prof, snap.switching, snap.targetOrgId) || layout
                    if (!isVisible) {
                        isVisible = true
                        layout = true
                    }
                }
            }
        }
        if (layout) revalidate()
        if (layout || paint) repaint()
    }

    @RequiresEdt
    private fun updateLoggedIn(prof: ai.kilocode.rpc.dto.ProfileDto, switching: Boolean, target: String?): Boolean {
        var layout = false

        val orgs = prof.organizations
        val next = listOf(AccountChoice(null, KiloBundle.message("profile.personalAccount"))) +
            orgs.map { org -> AccountChoice(org.id, org.name) }
        if (next != choices) {
            choices = next
            layout = true
        }

        if (currentOrgId != prof.currentOrgId) currentOrgId = prof.currentOrgId

        val activeId = if (switching) target else prof.currentOrgId
        val active = choices.firstOrNull { it.org == activeId } ?: choices.firstOrNull()
        val title = "${active?.title ?: " "} ▾"
        if (picker.text != title) {
            picker.text = title
            layout = true
        }

        val enabled = !switching
        if (picker.isEnabled != enabled) {
            picker.isEnabled = enabled
            picker.repaint()
        }

        val tip = if (switching) {
            KiloBundle.message("profile.switchingAccount")
        } else {
            KiloBundle.message("session.account.switcher")
        }
        if (picker.toolTipText != tip) picker.toolTipText = tip

        layout = syncBalance(prof) || layout
        return layout
    }

    @RequiresEdt
    private fun syncBalance(prof: ai.kilocode.rpc.dto.ProfileDto): Boolean {
        var layout = false
        val next = prof.balance?.let { formatBalance(it.balance) }
        if (next == null) {
            if (balance.isVisible) {
                balance.isVisible = false
                layout = true
            }
            if (balance.icon != null) {
                balance.icon = null
            }
            if (balance.toolTipText != null) balance.toolTipText = null
            balanceText = null
        } else {
            if (!balance.isVisible) {
                balance.isVisible = true
                layout = true
            }
            if (balanceText != next || balance.icon == null) {
                balance.icon = FilledBadgeIcon(
                    next,
                    UiStyle.Colors.badgeBg(),
                    UiStyle.Colors.badgeFg(),
                )
                layout = true
            }
            val tip = KiloBundle.message("session.account.balance", next)
            if (balance.toolTipText != tip) balance.toolTipText = tip
            balanceText = next
        }
        return layout
    }

    @RequiresEdt
    private fun showPopup() {
        val bg = SessionUiStyle.AccountPopup.bgColor()
        val model = CollectionListModel(choices)
        val list = JBList(model).apply {
            selectionMode = ListSelectionModel.SINGLE_SELECTION
            background = bg
            border = JBUI.Borders.empty(UiStyle.Gap.xs(), 0)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }
        list.cellRenderer = AccountPickerRenderer { currentOrgId }

        val idx = choices.indexOfFirst { it.org == currentOrgId }.takeIf { it >= 0 } ?: 0
        if (idx >= 0) {
            list.selectedIndex = idx
            ScrollingUtil.ensureIndexIsVisible(list, idx, 0)
        }

        lateinit var popup: com.intellij.openapi.ui.popup.JBPopup

        fun activate(choice: AccountChoice) {
            if (choice.org != currentOrgId) select(choice.org)
            popup.closeOk(null)
        }

        list.addMouseListener(object : MouseAdapter() {
            override fun mouseReleased(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_RELEASED, true)) return
                val row = list.locationToIndex(e.point)
                val bounds = row.takeIf { it >= 0 }?.let { list.getCellBounds(it, it) } ?: return
                if (!bounds.contains(e.point)) return
                activate(model.getElementAt(row))
            }
        })

        ListUtil.installAutoSelectOnMouseMove(list)
        ScrollingUtil.installActions(list)

        list.registerKeyboardAction(
            { list.selectedValue?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        list.registerKeyboardAction(
            { popup.cancel() },
            KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0),
            JComponent.WHEN_FOCUSED,
        )

        val scroll = ScrollPaneFactory.createScrollPane(list).apply {
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            border = JBUI.Borders.empty()
            viewportBorder = JBUI.Borders.empty()
            background = bg
            viewport.background = bg
            viewport.isOpaque = true
        }
        val content = RoundedContentPanel(UiStyle.Gap.sm(), UiStyle.Gap.sm()).apply {
            addToCenter(scroll)
        }

        popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(content, list)
            .setRequestFocus(true)
            .setFocusable(true)
            .setCancelOnClickOutside(true)
            .setCancelKeyEnabled(true)
            .setCancelOnWindowDeactivation(true)
            .setResizable(false)
            .setMovable(false)
            .createPopup()

        popup.showUnderneathOf(picker)
    }

    /**
     * Activate an account choice without showing the popup.
     * Only calls [select] when the choice differs from [currentOrgId].
     * Used by tests and by the popup's confirm action.
     */
    @RequiresEdt
    internal fun activate(choice: AccountChoice) {
        if (choice.org != currentOrgId) select(choice.org)
    }

    internal fun loggedInVisible() = isVisible
    internal fun accountTitle(): String? = picker.text?.removeSuffix(" ▾")?.ifBlank { null }
    internal fun pickerEnabled() = picker.isEnabled
    internal fun pickerVisible() = picker.isVisible
    internal fun choiceCount() = choices.size
    internal fun selectedIndex() = choices.indexOfFirst { it.org == currentOrgId }.takeIf { it >= 0 } ?: 0
    internal fun panelBackground() = panel.background
    internal fun panelBorderColor() = SessionUiStyle.AccountPopup.outlineColor()
    internal fun balanceVisible() = balance.isVisible
    internal fun balanceIcon() = balance.icon
    internal fun balanceText() = balanceText
    internal fun profileIcon() = profileBtn.icon
    internal fun clickProfile() = profileBtn.doClick()
}
