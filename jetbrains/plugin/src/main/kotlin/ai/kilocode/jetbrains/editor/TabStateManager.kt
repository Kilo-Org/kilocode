// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.editor

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.util.*
import java.util.concurrent.ConcurrentHashMap

/**
 * Tab State Manager
 *
 * Manages the state of editor tabs and tab groups, handling operations like
 * creating, updating, moving, and removing tabs and tab groups.
 */
class TabStateManager(var project: Project) {
    private val logger = Logger.getInstance(TabStateManager::class.java)

    // MARK: - State storage
    private var state = TabsState()
    private val tabHandles = ConcurrentHashMap<String, TabHandle>()
    private val groupHandles = ConcurrentHashMap<Int, TabGroupHandle>()
    private val tabStateService: TabStateService
    init {
        tabStateService = TabStateService(project)
    }

    // MARK: - ID generation
    private var nextGroupId = 1

    // MARK: - Public methods

    /**
     * Creates a new tab group
     *
     * @param viewColumn The view column for the group
     * @param isActive Whether this group should be the active group
     * @return Handle to the created tab group
     */
    fun createTabGroup(viewColumn: Int, isActive: Boolean = false): TabGroupHandle {
        // Generate new group ID
        val groupId = nextGroupId++

        // Create tab group
        val group = EditorTabGroupDto(
            groupId = groupId,
            isActive = isActive,
            viewColumn = viewColumn,
            tabs = emptyList(),
        )
        state.groups[groupId] = group

        // If this is the active group, update the state of other groups
        if (isActive) {
            state.groups.forEach { (id, otherGroup) ->
                if (id != groupId) {
                    state.groups[id] = otherGroup.copy(isActive = false)
                }
            }
        }

        // Create tab group handle
        val handle = TabGroupHandle(
            groupId = groupId,
            manager = this,
        )
        groupHandles[groupId] = handle

        // Send update event for all groups
        tabStateService.acceptEditorTabModel(state.groups.values.toList())

        return handle
    }

    /**
     * Removes a tab group
     *
     * @param groupId ID of the group to remove
     */
    fun removeGroup(groupId: Int) {
        state.groups.remove(groupId)
        groupHandles.remove(groupId)

        // Remove handles for all tabs in this group
        tabHandles.entries.removeAll { it.value.groupId == groupId }

        // Send update event for all groups
//        tabStateService.acceptEditorTabModel(state.groups.values.toList())
    }

    /**
     * Gets a handle to a tab group
     *
     * @param groupId ID of the group
     * @return Handle to the tab group, or null if not found
     */
    fun getTabGroupHandle(groupId: Int): TabGroupHandle? = groupHandles[groupId]

    // MARK: - Internal methods

    /**
     * Creates a new tab in a group
     *
     * @param groupId ID of the group to create the tab in
     * @param input Input for the tab content
     * @param options Options for the tab
     * @return Handle to the created tab
     */
    internal suspend fun createTab(groupId: Int, input: TabInputBase, options: TabOptions): TabHandle {
        if (input is EditorTabInput) {
            logger.info("create tab s" + input.uri?.path)
        }
        if (input is TextDiffTabInput) {
            logger.info("create tab d" + input.modified.path)
        }
        val group = state.groups[groupId] ?: error("Group not found: $groupId")
// Create tab
        val tab = EditorTabDto(
            id = UUID.randomUUID().toString(),
            label = "", // Compatibility with Roocode 0.61+: API request gets stuck without label field
            input = input,
            isActive = options.isActive,
            isPinned = options.isPinned,
            isPreview = !options.isPinned,
            isDirty = false,
        )

// Add to group
        val newTabs = group.tabs + tab
        val newGroup = group.copy(tabs = newTabs)
        state.groups[groupId] = newGroup

// Create tab handle
        val handle = TabHandle(
            id = tab.id,
            groupId = groupId,
            manager = this,
        )
        tabHandles[tab.id] = handle

        // Send tab operation event and group update event
        tabStateService.acceptTabOperation(
            TabOperation(
                groupId = groupId,
                index = newTabs.size - 1,
                tabDto = tab,
                kind = TabModelOperationKind.TAB_OPEN.value,
                oldIndex = null,
            ),
        )
        tabStateService.acceptTabGroupUpdate(newGroup)
        return handle
    }

    /**
     * Removes a tab
     *
     * @param id ID of the tab to remove
     * @return Handle to the removed tab, or null if not found
     */
    internal fun removeTab(id: String): TabHandle? {
        val handle = tabHandles[id] ?: return null
        val group = state.groups[handle.groupId] ?: return null

        // Find the index of the tab in the group
        val index = group.tabs.indexOfFirst { it.id == id }
        if (index != -1) {
            val tab = group.tabs[index]

            if (tab.input is EditorTabInput) {
                logger.info("remove tab s" + tab.input.uri?.path)
            }
            if (tab.input is TextDiffTabInput) {
                logger.info("remove tab d" + tab.input.modified.path)
            }

            val newTabs = group.tabs.toMutableList().apply { removeAt(index) }
            val newGroup = group.copy(tabs = newTabs)
            state.groups[handle.groupId] = newGroup
            state.groups[handle.groupId]?.isActive = false
            tabHandles.remove(id)

            // Send tab operation event and group update event
            tabStateService.acceptTabOperation(
                TabOperation(
                    groupId = handle.groupId,
                    index = index,
                    tabDto = tab,
                    kind = TabModelOperationKind.TAB_CLOSE.value,
                    oldIndex = null,
                ),
            )
            tabStateService.acceptTabGroupUpdate(newGroup)
        }
        return handle
    }

    /**
     * Updates a tab using the provided update function
     *
     * @param id ID of the tab to update
     * @param update Function that takes the current tab and returns an updated tab
     */
    internal suspend fun updateTab(id: String, update: (EditorTabDto) -> EditorTabDto) {
        val handle = tabHandles[id] ?: return
        val group = state.groups[handle.groupId] ?: return

        // Find the index of the tab in the group
        val index = group.tabs.indexOfFirst { it.id == id }
        if (index != -1) {
            val tab = update(group.tabs[index])
            val newTabs = group.tabs.toMutableList().apply { this[index] = tab }
            state.groups[handle.groupId] = group.copy(tabs = newTabs)

            // Send tab operation event and group update event
            tabStateService.acceptTabOperation(
                TabOperation(
                    groupId = handle.groupId,
                    index = index,
                    tabDto = tab,
                    kind = TabModelOperationKind.TAB_UPDATE.value,
                    oldIndex = null,
                ),
            )
//            tabStateService.acceptEditorTabModel(state.groups.values.toList())
        }
    }

    /**
     * Moves a tab to a new position, possibly in a different group
     *
     * @param id ID of the tab to move
     * @param toGroupId ID of the destination group
     * @param toIndex Index in the destination group
     */
    internal suspend fun moveTab(id: String, toGroupId: Int, toIndex: Int) {
        val handle = tabHandles[id] ?: return
        val fromGroup = state.groups[handle.groupId] ?: return
        val toGroup = state.groups[toGroupId] ?: return

        // Find the index of the tab in the source group
        val fromIndex = fromGroup.tabs.indexOfFirst { it.id == id }
        if (fromIndex != -1) {
            val tab = fromGroup.tabs[fromIndex]

            // If moving within the same group
            if (handle.groupId == toGroupId) {
                val newTabs = fromGroup.tabs.toMutableList().apply {
                    removeAt(fromIndex)
                    add(toIndex, tab)
                }
                state.groups[handle.groupId] = fromGroup.copy(tabs = newTabs)

                // Send tab operation event and group update event
                tabStateService.acceptTabOperation(
                    TabOperation(
                        groupId = handle.groupId,
                        index = toIndex,
                        tabDto = tab,
                        kind = TabModelOperationKind.TAB_MOVE.value,
                        oldIndex = fromIndex,
                    ),
                )
//                tabStateService.acceptEditorTabModel(state.groups.values.toList())
            } else {
                // Moving between groups
                val newFromTabs = fromGroup.tabs.toMutableList().apply { removeAt(fromIndex) }
                val newToTabs = toGroup.tabs.toMutableList().apply { add(toIndex, tab) }
                state.groups[handle.groupId] = fromGroup.copy(tabs = newFromTabs)
                state.groups[toGroupId] = toGroup.copy(tabs = newToTabs)

                // Update the group ID in the tab handle
                handle.groupId = toGroupId

                // Send tab operation event and group update event
                tabStateService.acceptTabOperation(
                    TabOperation(
                        groupId = toGroupId,
                        index = toIndex,
                        tabDto = tab,
                        kind = TabModelOperationKind.TAB_MOVE.value,
                        oldIndex = fromIndex,
                    ),
                )
//                tabStateService.acceptEditorTabModel(state.groups.values.toList())
            }
        }
    }

    /**
     * Updates tab state properties
     *
     * @param id ID of the tab to update
     * @param isActive Whether the tab is active
     * @param isDirty Whether the tab is dirty (has unsaved changes)
     * @param isPinned Whether the tab is pinned
     */
    internal suspend fun updateTab(
        id: String,
        isActive: Boolean? = null,
        isDirty: Boolean? = null,
        isPinned: Boolean? = null,
    ) {
        updateTab(id) { tab ->
            tab.copy(
                isActive = isActive ?: tab.isActive,
                isDirty = isDirty ?: tab.isDirty,
                isPinned = isPinned ?: tab.isPinned,
                isPreview = if (isPinned != null) !isPinned else tab.isPreview,
            )
        }
    }

    /**
     * Sets the active group
     *
     * @param groupId ID of the group to set as active
     */
    fun setActiveGroup(groupId: Int) {
        state.groups.forEach { (id, group) ->
            state.groups[id] = group.copy(isActive = id == groupId)
        }

        // Send update event for all groups
        tabStateService.acceptEditorTabModel(state.groups.values.toList())
    }

    /**
     * Gets a handle to a tab
     *
     * @param id ID of the tab
     * @return Handle to the tab, or null if not found
     */
    fun getTabHandle(id: String): TabHandle? = tabHandles[id]

    /**
     * Gets a tab group
     *
     * @param groupId ID of the group
     * @return The tab group, or null if not found
     */
    internal fun getTabGroup(groupId: Int): EditorTabGroupDto? = state.groups[groupId]

    /**
     * Gets all tab groups
     *
     * @return List of all tab groups
     */
    fun getAllGroups(): List<EditorTabGroupDto> = state.groups.values.toList()

    /**
     * Closes the manager and cleans up resources
     */
    suspend fun close() {
//        tabOperationEvents.resetReplayCache()
//        groupUpdateEvents.resetReplayCache()
//        allGroupsUpdateEvents.resetReplayCache()
    }
}

/**
 * Tab state container
 * Holds the state of all tab groups
 */
data class TabsState(
    val groups: MutableMap<Int, EditorTabGroupDto> = ConcurrentHashMap(),
)

/**
 * Tab options
 * Configuration options for creating tabs
 */
data class TabOptions(
    val isActive: Boolean = false,
    val isPinned: Boolean = false,
    val isPreview: Boolean = false,
) {
    companion object {
        val DEFAULT = TabOptions()
    }
}
/**
 * Tab group handle
 * Provides operations for a specific tab group
 */
/**
 * Provides operations for a specific tab group.
 * @property groupId The unique identifier for this tab group.
 * @property manager The TabStateManager instance managing this group.
 */
class TabGroupHandle(
    /**
     * The unique identifier for this tab group.
     */
    val groupId: Int,
    /**
     * The TabStateManager instance managing this group.
     */
    private val manager: TabStateManager,
) {

    /**
     * Gets the tab group data.
     */
    val group: EditorTabGroupDto?
        get() = manager.getTabGroup(groupId)

    /**
     * Adds a tab to this group.
     *
     * @param input Input for the tab content.
     * @param options Options for the tab.
     * @return Handle to the created tab.
     */
    suspend fun addTab(input: TabInputBase, options: TabOptions = TabOptions.DEFAULT): TabHandle? =
        manager.createTab(groupId, input, options)

    /**
     * Moves a tab to a specified position within this group.
     *
     * @param id ID of the tab to move.
     * @param toIndex Destination index.
     */
    suspend fun moveTab(id: String, toIndex: Int) {
        manager.moveTab(id, groupId, toIndex)
    }

    /**
     * Gets a handle to a tab in this group.
     *
     * @param id ID of the tab.
     * @return Handle to the tab, or null if not found.
     */
    suspend fun getTabHandle(id: String): TabHandle? = manager.getTabHandle(id)

    /**
     * Gets all tabs in this group.
     */
    val tabs: List<EditorTabDto>
        get() = group?.tabs ?: emptyList()

    /**
     * Removes this tab group and all its tabs.
     * Closes all tabs in the group and removes the group from the manager.
     */
    suspend fun remove() {
        group?.tabs?.forEach { tab ->
            getTabHandle(tab.id)?.close()
        }
        manager.removeGroup(groupId)
    }
}
/**
 * Tab handle
 * Provides operations for a specific tab
 */
/**
 * Provides operations for a specific tab.
 * @property id The unique identifier for this tab.
 * @property groupId The group ID this tab belongs to.
 * @property manager The TabStateManager instance managing this tab.
 */
class TabHandle(
    /**
     * The unique identifier for this tab.
     */
    val id: String,
    /**
     * The group ID this tab belongs to.
     */
    var groupId: Int,
    /**
     * The TabStateManager instance managing this tab.
     */
    private val manager: TabStateManager,
) {

    /**
     * Closes this tab by removing it from the manager.
     */
    suspend fun close() {
        manager.removeTab(id)
    }

    /**
     * Updates this tab using the provided update function.
     *
     * @param update Function that takes the current tab and returns an updated tab.
     */
    suspend fun update(update: (EditorTabDto) -> EditorTabDto) {
        manager.updateTab(id, update)
    }
}
