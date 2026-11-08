package ai.kilocode.backend.testing

import com.intellij.execution.CommonProgramRunConfigurationParameters
import com.intellij.execution.Executor
import com.intellij.execution.configurations.ConfigurationType
import com.intellij.execution.configurations.ConfigurationFactory
import com.intellij.execution.configurations.ConfigurationTypeBase
import com.intellij.execution.configurations.ModuleBasedConfiguration
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.execution.configurations.RunConfigurationModule
import com.intellij.execution.configurations.RunProfileState
import com.intellij.execution.runners.ExecutionEnvironment
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.module.Module
import com.intellij.openapi.options.SettingsEditor
import com.intellij.openapi.project.Project
import com.intellij.testFramework.ExtensionTestUtil
import org.jdom.Element

/**
 * Stand-in for the Java plugin's plain application run configuration type. Whether the platform test
 * fixture ships the real one depends on the platform plugin version, so tests hide it with [ConfigTypes]
 * and register this instead. `WorktreeRunDelegate.plain` looks the type up by this id, so any test of
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
 * Run configuration types for one test. Hides any real "Application" type the test platform ships:
 * older platform plugin versions left the Java plugin out of the test runtime, newer ones put it in,
 * and tests must not depend on which.
 *
 * Types are added through the mask rather than `registerExtension`, because a masked extension point
 * is read-only. [mask] runs once from `setUp`, and each [add] runs it again so earlier types stay
 * registered.
 */
class ConfigTypes(private val parent: Disposable) {
    private val types = mutableListOf<ConfigurationType>()
    private var scope: Disposable? = null

    /** Hides the real "Application" type and registers the types added so far. Replaces the previous mask. */
    fun mask() {
        scope?.let { Disposer.dispose(it) }
        val next = Disposer.newDisposable(parent, "ConfigTypes")
        scope = next
        val point = ConfigurationType.CONFIGURATION_TYPE_EP
        ExtensionTestUtil.maskExtensions(point, point.extensionList.filter { it.id != PlainApplicationType.ID } + types, next)
    }

    fun <T : ConfigurationType> add(type: T): T {
        types += type
        mask()
        return type
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
