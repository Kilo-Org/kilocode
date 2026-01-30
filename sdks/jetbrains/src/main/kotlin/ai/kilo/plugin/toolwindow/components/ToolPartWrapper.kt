package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.model.Part
import ai.kilo.plugin.model.PermissionRequest
import ai.kilo.plugin.model.QuestionRequest
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTypography
import ai.kilo.plugin.toolwindow.KiloRadius
import com.intellij.icons.AllIcons
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.*
import java.awt.geom.RoundRectangle2D
import javax.swing.*

/**
 * Wrapper component for tool parts that can display inline permission and question prompts.
 * Features an animated gold border for pending permissions (matching web client UX).
 */
class ToolPartWrapper(
    private val part: Part,
    private val permission: PermissionRequest?,
    private val question: QuestionRequest?,
    private val onPermissionReply: (requestId: String, reply: String) -> Unit,
    private val onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
    private val onQuestionReject: (requestId: String) -> Unit
) : JPanel(BorderLayout()) {

    private var borderAngle = 0
    private var animationTimer: Timer? = null

    init {
        isOpaque = false
        border = JBUI.Borders.empty(KiloSpacing.xs)

        // Build the tool card content
        val toolCard = createToolCard()
        add(toolCard, BorderLayout.NORTH)

        // Add permission prompt if pending
        if (permission != null) {
            val permissionPrompt = InlinePermissionPrompt(permission) { reply ->
                onPermissionReply(permission.id, reply)
            }
            add(permissionPrompt, BorderLayout.CENTER)
            startBorderAnimation()
        }

        // Add question prompt if pending (and no permission - permission takes priority)
        if (question != null && permission == null) {
            val questionPrompt = InlineQuestionPrompt(
                request = question,
                onReply = { answers -> onQuestionReply(question.id, answers) },
                onReject = { onQuestionReject(question.id) }
            )
            add(questionPrompt, BorderLayout.CENTER)
        }
    }

    private fun createToolCard(): JPanel {
        val card = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = KiloTheme.surfaceRaisedBase
            border = JBUI.Borders.compound(
                JBUI.Borders.customLine(KiloTheme.borderWeak),
                JBUI.Borders.empty(KiloSpacing.md)
            )
        }

        // Tool header with status icon
        val status = part.toolStatus
        val icon = when (status) {
            "pending" -> AllIcons.Process.Step_1
            "running" -> AllIcons.Process.Step_2
            "completed" -> AllIcons.Actions.Checked
            "error" -> AllIcons.General.Error
            else -> AllIcons.Process.Step_1
        }

        val toolName = part.tool ?: "Unknown tool"
        val title = part.toolTitle ?: formatToolName(toolName)
        val header = JBLabel(title, icon, SwingConstants.LEFT).apply {
            font = font.deriveFont(Font.BOLD, KiloTypography.fontSizeSmall)
            foreground = KiloTheme.textStrong
        }
        card.add(header, BorderLayout.NORTH)

        // Tool output (if available)
        val output = part.toolOutput
        if (output != null && output.isNotBlank()) {
            val outputArea = JTextArea().apply {
                isEditable = false
                lineWrap = true
                wrapStyleWord = true
                isOpaque = false
                font = Font(Font.MONOSPACED, Font.PLAIN, KiloTypography.fontSizeXSmall.toInt())
                foreground = KiloTheme.textWeak
                text = output.take(500)
                border = JBUI.Borders.emptyTop(KiloSpacing.md)
            }
            card.add(outputArea, BorderLayout.CENTER)
        }

        // Error display
        val error = part.toolError
        if (error != null && error.isNotBlank()) {
            val errorLabel = JBLabel("<html><font color='${colorToHex(KiloTheme.textCritical)}'>$error</font></html>").apply {
                border = JBUI.Borders.emptyTop(KiloSpacing.md)
            }
            card.add(errorLabel, BorderLayout.SOUTH)
        }

        return card
    }
    
    private fun colorToHex(color: Color): String {
        return String.format("#%02x%02x%02x", color.red, color.green, color.blue)
    }

    private fun formatToolName(name: String): String {
        return when (name) {
            "read" -> "Read File"
            "write" -> "Write File"
            "edit" -> "Edit File"
            "bash" -> "Run Command"
            "glob" -> "Search Files"
            "grep" -> "Search Content"
            "webfetch" -> "Fetch URL"
            "task" -> "Agent Task"
            "todowrite" -> "Update Todos"
            "todoread" -> "Read Todos"
            "question" -> "Question"
            else -> name.replaceFirstChar { it.uppercase() }
        }
    }

    private fun startBorderAnimation() {
        animationTimer = Timer(40) { // ~25fps for smooth animation
            borderAngle = (borderAngle + 4) % 360
            repaint()
        }
        animationTimer?.start()
    }

    fun dispose() {
        animationTimer?.stop()
        animationTimer = null
    }

    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)

        if (permission != null) {
            drawAnimatedBorder(g as Graphics2D)
        } else if (question != null) {
            drawQuestionBorder(g as Graphics2D)
        }
    }

    private fun drawAnimatedBorder(g2: Graphics2D) {
        val oldRenderingHints = g2.renderingHints
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)

        val borderWidth = 2f
        val inset = borderWidth / 2
        val rect = RoundRectangle2D.Float(
            inset, inset,
            width - borderWidth, height - borderWidth,
            KiloRadius.lg.toFloat(), KiloRadius.lg.toFloat()
        )

        // Create rotating gradient paint
        val centerX = width / 2f
        val centerY = height / 2f
        val radius = maxOf(width, height).toFloat()

        // Calculate gradient stops based on angle
        val angleRad = Math.toRadians(borderAngle.toDouble())
        val x1 = (centerX + radius * kotlin.math.cos(angleRad)).toFloat()
        val y1 = (centerY + radius * kotlin.math.sin(angleRad)).toFloat()
        val x2 = (centerX - radius * kotlin.math.cos(angleRad)).toFloat()
        val y2 = (centerY - radius * kotlin.math.sin(angleRad)).toFloat()

        // Use theme warning colors for permission animation
        val color1 = KiloTheme.iconWarning
        val color2 = KiloTheme.iconWarningActive

        val gradient = GradientPaint(x1, y1, color1, x2, y2, color2)
        g2.paint = gradient
        g2.stroke = BasicStroke(borderWidth)
        g2.draw(rect)

        g2.setRenderingHints(oldRenderingHints)
    }

    private fun drawQuestionBorder(g2: Graphics2D) {
        val oldRenderingHints = g2.renderingHints
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)

        val borderWidth = 1f
        val inset = borderWidth / 2
        val rect = RoundRectangle2D.Float(
            inset, inset,
            width - borderWidth, height - borderWidth,
            KiloRadius.md.toFloat(), KiloRadius.md.toFloat()
        )

        g2.color = KiloTheme.borderInteractive
        g2.stroke = BasicStroke(borderWidth)
        g2.draw(rect)

        g2.setRenderingHints(oldRenderingHints)
    }
}
