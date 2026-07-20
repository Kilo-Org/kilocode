package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloAgentBehaviorRpcApi
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.McpServerConfigDto
import ai.kilocode.rpc.dto.McpStatusDto
import ai.kilocode.rpc.dto.SkillDto

class FakeAgentBehaviorRpcApi : KiloAgentBehaviorRpcApi {
    var agents = emptyList<AgentDetailDto>()
    var skills = emptyList<SkillDto>()
    var mcps = emptyList<McpStatusDto>()
    var mcpConfigs = emptyMap<String, McpServerConfigDto>()
    val agentCalls = mutableListOf<String>()
    val skillCalls = mutableListOf<String>()
    val skillRemovals = mutableListOf<Pair<String, String>>()
    val skillReloads = mutableListOf<String>()
    val skillSaves = mutableListOf<Triple<String, String, String>>()
    val mcpCalls = mutableListOf<String>()
    val mcpConfigCalls = mutableListOf<String>()
    val mcpSaves = mutableListOf<Triple<String, String, McpConfigDto?>>()
    val removals = mutableListOf<String>()
    val mcpConnects = mutableListOf<String>()
    val mcpDisconnects = mutableListOf<String>()
    val mcpAuthentications = mutableListOf<String>()
    val creations = mutableListOf<AgentCreateDto>()
    val createDirs = mutableListOf<String>()
    var afterCreate: (suspend (String, AgentCreateDto) -> Unit)? = null
    var afterRemove: (suspend (String, String) -> Unit)? = null
    var afterMcpConnect: (suspend (String, String) -> Unit)? = null
    var createError: Exception? = null
    var skillsError: Exception? = null
    var removeError: Exception? = null
    var removeSkillError: Exception? = null
    var saveSkillError: Exception? = null
    var mcpStatusError: Exception? = null
    var mcpConnectError: Exception? = null
    var removeResult = true
    var removeSkillResult = true
    var reloadSkillResult = true
    var saveSkillResult = true
    var mcpConnectResult = true
    var mcpDisconnectResult = true
    var mcpAuthenticateResult = true

    override suspend fun agents(directory: String): List<AgentDetailDto> {
        assertNotEdt("agentBehavior.agents")
        agentCalls.add(directory)
        return agents
    }

    override suspend fun skills(directory: String): List<SkillDto> {
        assertNotEdt("agentBehavior.skills")
        skillsError?.let { throw it }
        skillCalls.add(directory)
        return skills
    }

    override suspend fun removeSkill(directory: String, location: String): Boolean {
        assertNotEdt("agentBehavior.removeSkill")
        removeSkillError?.let { throw it }
        skillRemovals.add(directory to location)
        if (removeSkillResult) skills = skills.filterNot { it.location == location }
        return removeSkillResult
    }

    override suspend fun reloadSkills(directory: String): Boolean {
        assertNotEdt("agentBehavior.reloadSkills")
        skillReloads.add(directory)
        return reloadSkillResult
    }

    override suspend fun saveSkill(directory: String, location: String, content: String): Boolean {
        assertNotEdt("agentBehavior.saveSkill")
        saveSkillError?.let { throw it }
        skillSaves.add(Triple(directory, location, content))
        if (saveSkillResult) skills = skills.map { if (it.location == location) it.copy(content = content) else it }
        return saveSkillResult
    }

    override suspend fun saveSkills(directory: String, edits: Map<String, String>): Boolean {
        assertNotEdt("agentBehavior.saveSkills")
        saveSkillError?.let { throw it }
        for ((location, content) in edits) skillSaves.add(Triple(directory, location, content))
        if (saveSkillResult) skills = skills.map { skill ->
            edits[skill.location]?.let { skill.copy(content = it) } ?: skill
        }
        return saveSkillResult
    }

    override suspend fun removeAgent(directory: String, name: String): Boolean {
        assertNotEdt("agentBehavior.removeAgent")
        removeError?.let { throw it }
        removals.add(name)
        agents = agents.filterNot { it.name == name }
        afterRemove?.invoke(directory, name)
        return removeResult
    }

    override suspend fun createAgent(directory: String, input: AgentCreateDto): Boolean {
        assertNotEdt("agentBehavior.createAgent")
        createError?.let { throw it }
        createDirs.add(directory)
        creations.add(input)
        agents = agents.filterNot { it.name == input.name } + AgentDetailDto(
            name = input.name,
            description = input.description,
            mode = input.mode,
            native = false,
            removable = true,
        )
        afterCreate?.invoke(directory, input)
        return true
    }

    override suspend fun commands(directory: String): List<CommandDto> {
        assertNotEdt("agentBehavior.commands")
        return emptyList()
    }

    override suspend fun mcpStatus(directory: String): List<McpStatusDto> {
        assertNotEdt("agentBehavior.mcpStatus")
        mcpStatusError?.let { throw it }
        mcpCalls.add(directory)
        return mcps
    }

    override suspend fun mcpConfig(directory: String): Map<String, McpServerConfigDto> {
        assertNotEdt("agentBehavior.mcpConfig")
        mcpConfigCalls.add(directory)
        return mcpConfigs
    }

    override suspend fun saveMcp(directory: String, name: String, scope: String, config: McpConfigDto?): Boolean {
        assertNotEdt("agentBehavior.saveMcp")
        mcpSaves.add(Triple(name, scope, config))
        mcpConfigs = if (config == null) mcpConfigs - name else mcpConfigs + (name to McpServerConfigDto(config, scope))
        return true
    }

    override suspend fun mcpConnect(directory: String, name: String): Boolean {
        assertNotEdt("agentBehavior.mcpConnect")
        mcpConnectError?.let { throw it }
        mcpConnects.add(name)
        afterMcpConnect?.invoke(directory, name)
        return mcpConnectResult
    }

    override suspend fun mcpDisconnect(directory: String, name: String): Boolean {
        assertNotEdt("agentBehavior.mcpDisconnect")
        mcpDisconnects.add(name)
        return mcpDisconnectResult
    }

    override suspend fun mcpAuthenticate(directory: String, name: String): Boolean {
        assertNotEdt("agentBehavior.mcpAuthenticate")
        mcpAuthentications.add(name)
        return mcpAuthenticateResult
    }

    override suspend fun claudeCodeCompat(): Boolean {
        assertNotEdt("agentBehavior.claudeCodeCompat")
        return false
    }

    override suspend fun setClaudeCodeCompat(value: Boolean): Boolean {
        assertNotEdt("agentBehavior.setClaudeCodeCompat")
        return value
    }
}
