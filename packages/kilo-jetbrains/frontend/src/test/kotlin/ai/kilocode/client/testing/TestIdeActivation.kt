package ai.kilocode.client.testing

import com.intellij.openapi.application.ApplicationActivationListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.IdeFrame
import com.intellij.openapi.wm.StatusBar
import com.intellij.ui.BalloonLayout
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Publishes IDE frame activation for [project], the way the platform does when its window gains
 * focus. Headless tests have no real frame, so this carries a stub [IdeFrame] whose only meaningful
 * member is the project the listeners route on.
 */
fun activateIde(project: Project) {
    ApplicationManager.getApplication().messageBus
        .syncPublisher(ApplicationActivationListener.TOPIC)
        .applicationActivated(StubIdeFrame(project))
}

private class StubIdeFrame(private val project: Project) : IdeFrame {
    override fun getStatusBar(): StatusBar? = null
    override fun suggestChildFrameBounds(): Rectangle = Rectangle()
    override fun getProject(): Project = project
    override fun setFrameTitle(title: String) = Unit
    override fun getComponent(): JComponent = JPanel()
    override fun getBalloonLayout(): BalloonLayout? = null
}
