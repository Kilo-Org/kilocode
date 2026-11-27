package ai.kilocode.client.testing

import com.intellij.ui.components.JBList
import java.awt.event.MouseEvent

fun fire(list: JBList<*>, event: MouseEvent) {
    val listener = list.mouseListeners.single { it.javaClass.name.startsWith("ai.kilocode.") }
    when (event.id) {
        MouseEvent.MOUSE_PRESSED -> listener.mousePressed(event)
        MouseEvent.MOUSE_RELEASED -> listener.mouseReleased(event)
        MouseEvent.MOUSE_CLICKED -> listener.mouseClicked(event)
        else -> error("Unsupported mouse event ${event.id}")
    }
}
