package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.RoundedContentPanel
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.IconUtil
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D

class SessionDropOverlay : BorderLayoutPanel() {
    private val title = KiloBundle.message("session.drop.files.title")
    private val subtitle = KiloBundle.message("session.drop.files.subtitle")
    private val text = "$title $subtitle"
    private val card = Card()
    private var active = false

    init {
        isOpaque = false
        accessibleContext?.accessibleName = text

        val primary = JBLabel(title).apply {
            font = JBFont.h0()
            foreground = UIUtil.getLabelForeground()
        }
        val secondary = JBLabel(subtitle).apply {
            font = JBFont.h2()
            foreground = UIUtil.getLabelForeground()
        }
        val icon = JBLabel(IconUtil.scale(AllIcons.Actions.Download, null, 3f))
        val labels = Stack.vertical(JBUI.scale(SessionUiStyle.View.DropOverlay.LABEL_GAP))
            .next(primary.align(HAlign.CENTER, VAlign.CENTER))
            .next(secondary.align(HAlign.CENTER, VAlign.CENTER))
            .gap(JBUI.scale(SessionUiStyle.View.DropOverlay.ICON_GAP))
            .next(icon.align(HAlign.CENTER, VAlign.CENTER))
        card.apply {
            isVisible = false
            add(labels, BorderLayout.CENTER)
        }
        add(card.align(HAlign.CENTER, VAlign.CENTER), BorderLayout.CENTER)
    }

    @RequiresEdt
    fun setActive(value: Boolean) {
        if (active == value) return
        active = value
        card.isVisible = value
        revalidate()
        repaint()
    }

    override fun contains(x: Int, y: Int): Boolean = false

    override fun paintComponent(g: Graphics) {
        if (!active) {
            super.paintComponent(g)
            return
        }
        val g2 = g.create() as Graphics2D
        try {
            g2.color = SessionUiStyle.View.DropOverlay.scrim()
            g2.fillRect(0, 0, width, height)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    private class Card : RoundedContentPanel(
        JBUI.scale(SessionUiStyle.View.DropOverlay.CARD_VERTICAL_PADDING),
        JBUI.scale(SessionUiStyle.View.DropOverlay.CARD_HORIZONTAL_PADDING),
    ) {
        override fun contentColor(): Color = SessionUiStyle.View.DropOverlay.card()

        override fun outlineColor(): Color? = null

        override fun cornerArc(): Int = JBUI.scale(SessionUiStyle.View.DropOverlay.CARD_ARC)
    }
}
