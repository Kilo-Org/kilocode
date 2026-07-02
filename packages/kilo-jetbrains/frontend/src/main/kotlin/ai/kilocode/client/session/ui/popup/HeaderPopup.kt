package ai.kilocode.client.session.ui.popup

import com.intellij.openapi.Disposable
import java.awt.Color
import javax.swing.JComponent

class HeaderPopupRequest(
    val anchor: JComponent,
    val build: () -> HeaderPopupBody,
    val shown: () -> Unit = {},
)

class HeaderPopupBody(
    val component: JComponent,
    val disposable: Disposable,
    val background: Color,
)
