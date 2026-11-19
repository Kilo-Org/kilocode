package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.AgentManagerAvailability
import ai.kilocode.client.agentManager.AgentManagerCommand
import ai.kilocode.client.agentManager.AgentManagerDestination
import ai.kilocode.client.agentManager.AgentManagerElement
import ai.kilocode.client.agentManager.AgentManagerFacade
import ai.kilocode.client.agentManager.AgentManagerKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import ai.kilocode.client.testing.FakeAgentManagerFacade
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class AgentManagerActionsTest : BasePlatformTestCase() {
    private val local = AgentManagerElement.Local(WorktreeDto("/repo/worktree", "Feature", "feature", "/repo/worktree"))
    private val cloud = AgentManagerElement.Cloud(HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "workspace")))
    private val elements = listOf(local, cloud)

    fun testCommonActionsForwardTheExactElementAndCommandForBothTypes() = edtWait {
        elements.forEach { element ->
            actions().forEach { (command, action) ->
                val facade = manager()
                val event = event(action, facade, element)
                assertEquals(ActionUpdateThread.EDT, action.actionUpdateThread)
                assertTrue(action.isDumbAware)

                action.update(event)

                assertTrue(event.presentation.isEnabledAndVisible)
                assertSame(element, facade.queries.single().first)
                assertEquals(command, facade.queries.single().second)

                action.actionPerformed(event)

                assertEquals(2, facade.queries.size)
                assertTrue(facade.queries.all { it.first === element && it.second == command })
                val call = facade.calls.single()
                assertSame(element, call.element)
                assertEquals(command, call.command)
                assertNull(call.target)
            }
        }
    }

    fun testAllCommonPresentationsUseTheFacadeTriState() = edtWait {
        elements.forEach { element ->
            (actions() + (AgentManagerCommand.MOVE to MoveAgentManagerItemGroup())).forEach { (command, action) ->
                val facade = manager()
                val event = event(action, facade, element)
                AgentManagerAvailability.entries.forEach { state ->
                    facade.overrides[command] = state

                    action.update(event)

                    assertEquals("$command visibility", state.visible, event.presentation.isVisible)
                    assertEquals("$command enablement", state.enabled, event.presentation.isEnabled)
                }
                assertTrue(facade.calls.isEmpty())
                assertTrue(facade.queries.all { it.first === element && it.second == command })
            }
        }
    }

    fun testCommonActionsRequeryAvailabilityInsteadOfTrustingThePresentation() = edtWait {
        elements.forEach { element ->
            actions().forEach { (command, action) ->
                listOf(AgentManagerAvailability.DISABLED, AgentManagerAvailability.HIDDEN).forEach { state ->
                    val facade = manager()
                    val event = event(action, facade, element)
                    action.update(event)
                    assertTrue(event.presentation.isEnabled)
                    facade.overrides[command] = state

                    action.actionPerformed(event)

                    assertEquals(2, facade.queries.size)
                    assertTrue(facade.calls.isEmpty())
                    action.update(event)
                    assertFalse(event.presentation.isEnabled)
                    facade.overrides[command] = AgentManagerAvailability.ENABLED

                    action.actionPerformed(event)

                    assertSame(element, facade.calls.single().element)
                    assertEquals(command, facade.calls.single().command)
                }
            }
        }
    }

    fun testCommonActionsCaptureTheElementOnceBeforeQueryingAndPerforming() = edtWait {
        elements.forEach { element ->
            actions().forEach { (command, action) ->
                val facade = manager()
                var reads = 0
                val event = AnActionEvent.createFromDataContext("", Presentation(), DataContext { key ->
                    when {
                        AgentManagerKeys.FACADE.`is`(key) -> facade
                        AgentManagerKeys.ELEMENT.`is`(key) -> {
                            reads++
                            if (reads == 1) element else elements.first { it !== element }
                        }
                        else -> null
                    }
                })

                action.actionPerformed(event)

                assertEquals(1, reads)
                assertSame(element, facade.queries.single().first)
                assertSame(element, facade.calls.single().element)
                assertEquals(command, facade.calls.single().command)
            }
        }
    }

    fun testCommonActionsRequireBothFacadeAndElementWithoutRawDtoFallbacks() = edtWait {
        actions().forEach { (_, action) ->
            listOf(null to local, manager() to null, null to null).forEach { (facade, element) ->
                val keys = mutableListOf<String>()
                val context = DataContext { key ->
                    keys += key
                    when {
                        AgentManagerKeys.FACADE.`is`(key) -> facade
                        AgentManagerKeys.ELEMENT.`is`(key) -> element
                        WorktreeDataKeys.WORKTREE.`is`(key) -> local.dto
                        HostedWorkspaceDataKeys.WORKSPACE.`is`(key) -> cloud.dto
                        else -> null
                    }
                }
                val event = AnActionEvent.createFromDataContext("", Presentation(), context)

                action.update(event)
                action.actionPerformed(event)

                assertFalse(event.presentation.isVisible)
                assertFalse(event.presentation.isEnabled)
                assertFalse(keys.any { WorktreeDataKeys.WORKTREE.`is`(it) || HostedWorkspaceDataKeys.WORKSPACE.`is`(it) })
                assertTrue(facade?.queries.isNullOrEmpty())
                assertTrue(facade?.calls.isNullOrEmpty())
            }
        }
    }

    fun testMoveForwardsTheCapturedElementAndLiveDestinationNotTheClickContext() = edtWait {
        elements.forEach { element ->
            val facade = manager()
            facade.targets = listOf(
                AgentManagerDestination("current", "Current", enabled = false),
                AgentManagerDestination("next", "Next", "blue"),
            )
            val group = MoveAgentManagerItemGroup()
            val event = event(group, facade, element)
            group.update(event)
            assertEquals(ActionUpdateThread.EDT, group.actionUpdateThread)
            assertTrue(event.presentation.isEnabledAndVisible)
            val children = group.getChildren(event)
            assertEquals(2, children.size)
            val current = children.first()
            val child = children.last()
            val other = manager()
            val click = event(child, other, elements.first { it !== element })

            val disabled = event(current, other, null)
            current.update(disabled)
            assertTrue(disabled.presentation.isVisible)
            assertFalse(disabled.presentation.isEnabled)
            current.actionPerformed(click)
            assertTrue(facade.calls.isEmpty())
            facade.targets = listOf(AgentManagerDestination("next", "Renamed", "green"))
            child.update(click)
            assertEquals("Renamed", click.presentation.text)
            assertTrue(click.presentation.isEnabledAndVisible)

            child.actionPerformed(click)

            val call = facade.calls.single()
            assertSame(element, call.element)
            assertEquals(AgentManagerCommand.MOVE, call.command)
            assertEquals("next", call.target)
            assertTrue(facade.queries.all { it.first === element && it.second == AgentManagerCommand.MOVE })
            assertTrue(facade.requests.all { it === element })
            assertTrue(other.queries.isEmpty())
            assertTrue(other.calls.isEmpty())
        }
    }

    fun testMoveRejectsRemovedDisabledOrStaleDestinationsAtClickTime() = edtWait {
        elements.forEach { element ->
            val facade = manager()
            val destination = AgentManagerDestination("next", "Next")
            facade.targets = listOf(destination)
            val group = MoveAgentManagerItemGroup()
            val child = group.getChildren(event(group, facade, element)).single()
            val click = event(child, facade, element)

            facade.targets = emptyList()
            child.update(click)
            assertFalse(click.presentation.isVisible)
            child.actionPerformed(click)
            assertTrue(facade.calls.isEmpty())

            facade.targets = listOf(destination.copy(enabled = false))
            child.update(click)
            assertTrue(click.presentation.isVisible)
            assertFalse(click.presentation.isEnabled)
            child.actionPerformed(click)
            assertTrue(facade.calls.isEmpty())

            facade.targets = listOf(destination)
            listOf(AgentManagerAvailability.DISABLED, AgentManagerAvailability.HIDDEN).forEach { state ->
                facade.overrides[AgentManagerCommand.MOVE] = state
                child.update(click)
                assertEquals(state.visible, click.presentation.isVisible)
                assertFalse(click.presentation.isEnabled)
                child.actionPerformed(click)
                assertTrue(facade.calls.isEmpty())
            }

            facade.overrides[AgentManagerCommand.MOVE] = AgentManagerAvailability.ENABLED
            child.actionPerformed(click)
            assertSame(element, facade.calls.single().element)
            assertEquals("next", facade.calls.single().target)
        }
    }

    fun testMoveHasNoChildrenWithoutAnEnabledFacadeAndElement() = edtWait {
        val group = MoveAgentManagerItemGroup()
        val facade = manager()
        facade.targets = listOf(AgentManagerDestination("next", "Next"))
        assertTrue(group.getChildren(null).isEmpty())
        assertTrue(group.getChildren(event(group, null, local)).isEmpty())
        assertTrue(group.getChildren(event(group, facade, null)).isEmpty())
        listOf(AgentManagerAvailability.DISABLED, AgentManagerAvailability.HIDDEN).forEach { state ->
            facade.overrides[AgentManagerCommand.MOVE] = state
            assertTrue(group.getChildren(event(group, facade, local)).isEmpty())
        }
        assertTrue(facade.requests.isEmpty())
        assertTrue(facade.calls.isEmpty())
    }

    private fun actions(): List<Pair<AgentManagerCommand, AnAction>> = listOf(
        AgentManagerCommand.BROWSER to OpenWorktreePrAction(),
        AgentManagerCommand.RELOAD to ReloadHostedWorkspaceAction(),
        AgentManagerCommand.BASE_DIFF to OpenWorktreeDiffAction(),
        AgentManagerCommand.UNCOMMITTED_DIFF to OpenWorktreeLocalDiffAction(),
        AgentManagerCommand.UPDATE_BASE to UpdateWorktreeFromBaseAction(),
        AgentManagerCommand.COPY_BRANCH to CopyBranchNameAction(),
        AgentManagerCommand.COPY_PATH to CopyBranchPathAction(),
        AgentManagerCommand.COPY_PR to CopyWorktreePrRefAction(),
        AgentManagerCommand.SHOW_SETUP to OpenSetupScriptAction(),
        AgentManagerCommand.RUN_SETUP to RunWorktreeSetupScriptAction(),
        AgentManagerCommand.DELETE to DeleteWorktreeAction(),
    )

    private fun manager() = FakeAgentManagerFacade().apply { enabled = AgentManagerCommand.entries.toSet() }

    private fun event(action: AnAction, facade: AgentManagerFacade?, element: AgentManagerElement?): AnActionEvent =
        AnActionEvent.createFromDataContext("", action.templatePresentation.clone(), DataContext { key ->
            when {
                AgentManagerKeys.FACADE.`is`(key) -> facade
                AgentManagerKeys.ELEMENT.`is`(key) -> element
                else -> null
            }
        })
}
