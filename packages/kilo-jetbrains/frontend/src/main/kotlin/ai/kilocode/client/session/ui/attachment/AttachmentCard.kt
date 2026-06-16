package ai.kilocode.client.session.ui.attachment

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.iconButton
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.text.StringUtil
import com.intellij.xml.util.XmlStringUtil
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Container
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Image
import java.awt.LayoutManager2
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.io.ByteArrayInputStream
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import javax.imageio.ImageIO
import javax.swing.Icon
import javax.swing.ImageIcon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants
import javax.swing.SwingUtilities

data class AttachmentCardItem(
    val name: String,
    val mime: String,
    val url: String,
    val path: Path? = null,
)

open class AttachmentCard(
    private val item: AttachmentCardItem,
    remove: (() -> Unit)? = null,
    open: (() -> Unit)? = null,
) : JPanel(CardLayout()) {
    private var gen = 0
    private var loaded = false
    private val icon = attachmentIcon(item.mime, item.name)
    private val tip = tooltip(item)
    private val open = open?.let { callback ->
        object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                callback()
            }
        }
    }
    private val hover = object : MouseAdapter() {
        override fun mouseEntered(e: MouseEvent) {
            showAction(true)
        }

        override fun mouseMoved(e: MouseEvent) {
            showAction(true)
        }

        override fun mouseExited(e: MouseEvent) {
            val point = SwingUtilities.convertPoint(e.component, e.point, this@AttachmentCard)
            showAction(contains(point))
        }
    }
    private val preview = PreviewPanel(::watch).apply { setIcon(icon) }
    private val content = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.xs())
        add(preview, BorderLayout.CENTER)
    }
    private val action = remove?.let { callback ->
        CloseButton().apply {
            isVisible = false
            toolTipText = KiloBundle.message("prompt.attachment.remove", item.name)
            accessibleContext?.accessibleName = toolTipText
            addActionListener { callback() }
        }
    }

    init {
        isOpaque = false
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = tip
        accessibleContext?.accessibleName = KiloBundle.message("prompt.attachment.open", item.name)
        add(content)
        if (action != null) {
            add(action)
            setComponentZOrder(action, 0)
        }
        watch(this)
    }

    override fun getPreferredSize(): Dimension = JBUI.size(
        SessionUiStyle.View.Attachment.CARD_WIDTH,
        SessionUiStyle.View.Attachment.CARD_HEIGHT,
    )

    override fun getMinimumSize(): Dimension = preferredSize

    override fun getMaximumSize(): Dimension = preferredSize

    override fun addNotify() {
        super.addNotify()
        if (loaded) return
        loaded = true
        load()
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val arc = JBUI.scale(SessionUiStyle.View.Attachment.CORNER_ARC)
            g2.color = SessionUiStyle.View.Surface.bgColor()
            g2.fillRoundRect(0, 0, width, height, arc, arc)
            g2.color = SessionUiStyle.View.Outline.color()
            g2.drawRoundRect(0, 0, width - 1, height - 1, arc, arc)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    @RequiresEdt
    private fun load() {
        if (!item.mime.startsWith("image/")) return
        val stamp = ++gen
        val size = JBUI.size(
            SessionUiStyle.View.Attachment.CARD_WIDTH - UiStyle.Gap.xs() * 2,
            SessionUiStyle.View.Attachment.CARD_HEIGHT - UiStyle.Gap.xs() * 2,
        )
        ApplicationManager.getApplication().executeOnPooledThread {
            val image = runCatching {
                val data = decodeDataImage(item.url)
                val path = local(item)
                if (data != null) ImageIO.read(ByteArrayInputStream(data)) else path?.let { ImageIO.read(it.toFile()) }
            }.getOrNull()
            val scaled = image?.let { scale(it, size.width, size.height) }
            if (scaled == null) return@executeOnPooledThread
            ApplicationManager.getApplication().invokeLater {
                if (gen != stamp || !isDisplayable) return@invokeLater
                preview.setIcon(ImageIcon(scaled))
            }
        }
    }

    private fun watch(node: Component) {
        if (node is JComponent && node !is JButton) node.toolTipText = tip
        node.removeMouseListener(hover)
        node.removeMouseMotionListener(hover)
        node.addMouseListener(hover)
        node.addMouseMotionListener(hover)
        open?.let {
            node.removeMouseListener(it)
            if (node !is JButton) {
                node.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                node.addMouseListener(it)
            }
        }
        if (node is Container) node.components.forEach(::watch)
    }

    private fun showAction(value: Boolean) {
        val button = action ?: return
        if (button.isVisible == value) return
        button.isVisible = value
        revalidate()
        repaint()
    }

    private class PreviewPanel(private val watch: (Component) -> Unit) : JPanel(BorderLayout()) {
        init {
            isOpaque = false
        }

        override fun getPreferredSize(): Dimension = JBUI.size(
            SessionUiStyle.View.Attachment.CARD_WIDTH - UiStyle.Gap.xs() * 2,
            SessionUiStyle.View.Attachment.CARD_HEIGHT - UiStyle.Gap.xs() * 2,
        )

        fun setIcon(next: Icon) {
            val label = JBLabel(next, SwingConstants.CENTER).align(HAlign.CENTER, VAlign.CENTER)
            removeAll()
            add(label, BorderLayout.CENTER)
            watch(label)
            revalidate()
            repaint()
        }

        override fun paintComponent(g: Graphics) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                val arc = JBUI.scale(SessionUiStyle.View.Attachment.CORNER_ARC)
                g2.color = SessionUiStyle.View.Surface.headerHoverBgColor()
                g2.fillRoundRect(0, 0, width, height, arc, arc)
            } finally {
                g2.dispose()
            }
            super.paintComponent(g)
        }
    }

    private class CardLayout : LayoutManager2 {
        override fun addLayoutComponent(comp: Component, constraints: Any?) = Unit
        override fun addLayoutComponent(name: String?, comp: Component) = Unit
        override fun removeLayoutComponent(comp: Component) = Unit
        override fun minimumLayoutSize(parent: Container) = preferredLayoutSize(parent)
        override fun preferredLayoutSize(parent: Container) = JBUI.size(
            SessionUiStyle.View.Attachment.CARD_WIDTH,
            SessionUiStyle.View.Attachment.CARD_HEIGHT,
        )

        override fun maximumLayoutSize(target: Container) = preferredLayoutSize(target)
        override fun getLayoutAlignmentX(target: Container) = 0f
        override fun getLayoutAlignmentY(target: Container) = 0f
        override fun invalidateLayout(target: Container) = Unit

        override fun layoutContainer(parent: Container) {
            val size = JBUI.scale(SessionUiStyle.View.Attachment.CLOSE_SIZE)
            for (i in 0 until parent.componentCount) {
                val child = parent.getComponent(i)
                if (child is JButton) {
                    child.setBounds(parent.width - size - UiStyle.Gap.xs(), UiStyle.Gap.xs(), size, size)
                    continue
                }
                child.setBounds(0, 0, parent.width, parent.height)
            }
        }
    }

    private class CloseButton : JButton() {
        init {
            iconButton(this)
            icon = REMOVE_ICON
            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    icon = REMOVE_HOVER_ICON
                }

                override fun mouseExited(e: MouseEvent) {
                    icon = REMOVE_ICON
                }
            })
        }
    }

    companion object {
        private val REMOVE_ICON: Icon = IconLoader.getIcon("/icons/remove.svg", AttachmentCard::class.java)
        private val REMOVE_HOVER_ICON: Icon = IconLoader.getIcon("/icons/remove-hover.svg", AttachmentCard::class.java)
    }
}

private fun scale(image: Image, width: Int, height: Int): Image {
    val iw = image.getWidth(null)
    val ih = image.getHeight(null)
    if (iw <= 0 || ih <= 0) return image
    val ratio = minOf(width.toDouble() / iw, height.toDouble() / ih)
    val w = maxOf(1, (iw * ratio).toInt())
    val h = maxOf(1, (ih * ratio).toInt())
    return image.getScaledInstance(w, h, Image.SCALE_SMOOTH)
}

private fun local(item: AttachmentCardItem): Path? {
    if (item.path != null) return item.path
    val uri = runCatching { URI.create(item.url) }.getOrNull() ?: return null
    if (uri.scheme != "file") return null
    return runCatching { Path.of(uri) }.getOrNull()
}

private fun tooltip(item: AttachmentCardItem): String = XmlStringUtil.wrapInHtml(
    StringUtil.escapeXmlEntities(
        KiloBundle.message("prompt.attachment.tooltip", item.name, item.mime, location(item)),
    ).replace("\n", "<br>"),
)

private fun location(item: AttachmentCardItem): String {
    if (item.path != null) return item.path.toString()
    val uri = runCatching { URI.create(item.url) }.getOrNull()
    if (uri?.scheme == "data") return KiloBundle.message("prompt.attachment.embedded")
    if (uri?.scheme == "file") return runCatching { Path.of(uri).toString() }
        .getOrElse { URLDecoder.decode(uri.rawSchemeSpecificPart.removePrefix("//"), StandardCharsets.UTF_8) }
    return item.url
}
