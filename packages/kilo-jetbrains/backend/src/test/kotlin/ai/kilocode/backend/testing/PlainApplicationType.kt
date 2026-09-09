package ai.kilocode.backend.testing

import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.Executor
import com.intellij.execution.configurations.ConfigurationFactory
import com.intellij.execution.configurations.ConfigurationTypeBase
import com.intellij.execution.configurations.ModuleBasedConfiguration
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.execution.configurations.RunConfigurationModule
import com.intellij.execution.configurations.RunProfileState
import com.intellij.execution.runners.ExecutionEnvironment
import com.intellij.openapi.module.Module
import com.intellij.openapi.options.SettingsEditor
import com.intellij.openapi.project.Project
import org.jdom.Element

/**
 * Stand-in for the Java plugin's plain application run configuration type, which the platform test
 * fixture does not ship. `WorktreeRunDelegate.plain` looks the real one up by this id, so any test of
 * the plain-application fallback must register a type under it.
 *
 * Shared rather than duplicated per test class on purpose: the lookup takes the first type with this
 * id, so two classes registering different stand-ins under the same id make the outcome depend on test
 * order.
 */
class PlainApplicationType : ConfigurationTypeBase(ID, "Plain Application", null, null as javax.swing.Icon?) {
    init {
        addFactory(object : ConfigurationFactory(this) {
            override fun getId(): String = type.id

            override fun createTemplateConfiguration(project: Project): RunConfiguration =
                PlainApplicationConfig(project, this, "")
        })
    }

    companion object {
        const val ID = "Application"
    }
}

/**
 * Reads back only the JVM option tags a plain application configuration understands — the reason a
 * framework-only option shows up as dropped when a configuration is copied into this type.
 */
class PlainApplicationConfig(project: Project, factory: ConfigurationFactory, name: String) :
    ModuleBasedConfiguration<RunConfigurationModule, Any>(name, RunConfigurationModule(project), factory),
    CommonProgramRunConfigurationParameters {
    var main: String? = null
    private var dir: String? = null
    private var params: String? = null
    private var env: MutableMap<String, String> = mutableMapOf()
    private var parent = true

    override fun getValidModules(): Collection<Module> = emptyList()

    override fun getConfigurationEditor(): SettingsEditor<out RunConfiguration> = throw UnsupportedOperationException()

    override fun getState(executor: Executor, environment: ExecutionEnvironment): RunProfileState? = null

    override fun setProgramParameters(value: String?) {
        params = value
    }

    override fun getProgramParameters(): String? = params

    override fun setWorkingDirectory(value: String?) {
        dir = value
    }

    override fun getWorkingDirectory(): String? = dir

    override fun setEnvs(envs: MutableMap<String, String>) {
        env = HashMap(envs)
    }

    override fun getEnvs(): MutableMap<String, String> = env

    override fun setPassParentEnvs(passParentEnvs: Boolean) {
        parent = passParentEnvs
    }

    override fun isPassParentEnvs(): Boolean = parent

    override fun readExternal(element: Element) {
        super.readExternal(element)
        val options = element.children.filter { it.name == OPTION }
            .associate { it.getAttributeValue("name") to it.getAttributeValue("value") }
        main = options[MAIN_CLASS]
        dir = options[WORKING_DIR]
        params = options[PROGRAM_PARAMS]
        env = element.getChild(ENVS)?.children.orEmpty()
            .associate { it.getAttributeValue("name") to it.getAttributeValue("value") }
            .toMutableMap()
    }

    override fun writeExternal(element: Element) {
        super.writeExternal(element)
        main?.let { element.addContent(option(MAIN_CLASS, it)) }
        dir?.let { element.addContent(option(WORKING_DIR, it)) }
        params?.let { element.addContent(option(PROGRAM_PARAMS, it)) }
        if (env.isNotEmpty()) {
            val envs = Element(ENVS)
            env.forEach { (k, v) -> envs.addContent(Element("env").setAttribute("name", k).setAttribute("value", v)) }
            element.addContent(envs)
        }
    }

    companion object {
        const val MAIN_CLASS = "MAIN_CLASS_NAME"
        const val WORKING_DIR = "WORKING_DIRECTORY"
        const val PROGRAM_PARAMS = "PROGRAM_PARAMETERS"
        private const val ENVS = "envs"
        private const val OPTION = "option"

        fun option(name: String, value: String): Element =
            Element(OPTION).setAttribute("name", name).setAttribute("value", value)
    }
}
