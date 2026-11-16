package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceIcons
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.codeInsight.hint.HintUtil
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.impl.ActionButtonWithText
import com.intellij.openapi.util.JDOMUtil
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JLabel
import javax.swing.SwingConstants
import javax.swing.UIManager

@Suppress("UnstableApiUsage")
class AgentManagerAddActionTest : BasePlatformTestCase() {
    fun `test toolbar presentation uses short text`() {
        val action = AgentManagerAddAction()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER, ui = ActionUiKind.TOOLBAR)

        ActionUtil.updateAction(action, event)

        assertEquals("Add", event.presentation.text)
        assertSame(KiloActionIcons.add, event.presentation.icon)
    }

    fun `test non-toolbar presentation keeps full text`() {
        val action = AgentManagerAddAction()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER)

        ActionUtil.updateAction(action, event)

        assertEquals("Add Workspace", event.presentation.text)
    }

    fun `test custom component is an ActionButtonWithText bound to the presentation`() {
        val action = AgentManagerAddAction()
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }

        val component = action.createCustomComponent(presentation, ActionPlaces.TOOLWINDOW_TITLE)

        val button = assertInstanceOf(component, ActionButtonWithText::class.java)
        assertSame(presentation, button.presentation)
    }

    fun `test action visible on agent manager tab`() {
        val action = AgentManagerAddAction()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER)

        ActionUtil.updateAction(action, event)

        assertTrue(event.presentation.isVisible)
    }

    fun `test action hidden on chat tab`() {
        val action = AgentManagerAddAction()
        val event = event(action, mode = SidePanelMode.CHAT)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isVisible)
    }

    fun `test action disabled without worktree panel`() {
        val action = AgentManagerAddAction()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    fun `test add hint has no planned-feature copy`() {
        val hint = ai.kilocode.client.plugin.KiloBundle.message("agentManager.add.hint")

        assertFalse(hint.contains("<hr"))
        assertFalse(hint.contains("coming soon", ignoreCase = true))
        assertEquals("Move tasks between local and Cloud anytime.", hint)
    }

    fun `test popup hint fits on one line without clipping`() {
        val offset = UIManager.get("Popup.Advertiser.fontSizeOffset")
        try {
            for (value in listOf(0, -8)) {
                UIManager.put("Popup.Advertiser.fontSizeOffset", value)
                val popup = AgentManagerAddAction().popup(DataContext.EMPTY_CONTEXT)
                Disposer.register(testRootDisposable, popup)
                val content = popup.content
                val footer = (content.layout as BorderLayout).getLayoutComponent(BorderLayout.SOUTH) as JLabel
                val hint = HintUtil.createAdComponent(KiloBundle.message("agentManager.add.hint"),
                    JBUI.CurrentTheme.Advertiser.border(), SwingConstants.LEFT)

                content.size = content.preferredSize
                content.doLayout()

                assertTrue(footer.text.startsWith("<html>"))
                assertFalse(footer.text.contains("<div"))
                assertEquals(hint.preferredSize.height, footer.preferredSize.height)
                assertTrue(footer.width >= hint.preferredSize.width)
            }
        } finally {
            UIManager.put("Popup.Advertiser.fontSizeOffset", offset)
        }
    }

    fun `test add group items carry branch and cloud icons`() {
        val children = AgentManagerAddAction().getChildren(null)

        assertSame(AllIcons.Vcs.Branch, children[0].templatePresentation.icon)
        assertSame(HostedWorkspaceIcons.cloud, children[1].templatePresentation.icon)
    }

    fun `test add group offers section after local and cloud with a separator`() {
        val action = AgentManagerAddAction()
        val children = action.getChildren(null)

        assertTrue(action.isPopup)
        assertTrue(action.templatePresentation.isPerformGroup)
        assertEquals(4, children.size)
        assertInstanceOf(children[2], Separator::class.java)
        assertEquals(
            listOf("Local Worktree Task", "Cloud Task", "New Section"),
            children.filterNot { it is Separator }.map { it.templatePresentation.text },
        )
    }

    fun `test new section action disabled without worktree panel`() {
        val action = AgentManagerAddAction().getChildren(null).last()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    fun `test unified Add group replaces the standalone cloud actions`() {
        val root = requireNotNull(javaClass.getResourceAsStream("/kilo.jetbrains.frontend.xml")).use { JDOMUtil.load(it) }
        val actions = requireNotNull(root.getChild("actions")).children
        val group = actions.single { it.getAttributeValue("id") == "Kilo.AgentManager.Add" }

        assertEquals("group", group.name)
        assertEquals(AgentManagerAddAction::class.java.name, group.getAttributeValue("class"))
        assertEquals("true", group.getAttributeValue("popup"))
        assertFalse(actions.any { it.getAttributeValue("id") == "Kilo.HostedWorkspace.AddExisting" })
        assertFalse(actions.any { it.getAttributeValue("id") == "Kilo.HostedWorkspace.Create" })
    }

    private fun event(
        action: AnAction,
        mode: SidePanelMode? = null,
        ui: ActionUiKind = ActionUiKind.NONE,
    ): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val context = DataContext { id ->
            if (SidePanelKeys.MODE.`is`(id)) return@DataContext mode
            null
        }
        return AnActionEvent.createEvent(context, presentation, ActionPlaces.TOOLWINDOW_TITLE, ui, null)
    }
}
