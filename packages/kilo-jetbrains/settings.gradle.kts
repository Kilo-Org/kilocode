rootProject.name = "kilo.jetbrains"

include("shared")
include("frontend")
include("backend")

pluginManagement {
    includeBuild("build-tasks")
    resolutionStrategy {
        eachPlugin {
            if (requested.id.id == "org.jetbrains.intellij.platform") {
                useModule("org.jetbrains.intellij.platform:intellij-platform-gradle-plugin:${requested.version}")
            }
        }
    }
    repositories {
        maven("https://central.sonatype.com/repository/maven-snapshots/") {
            content {
                includeGroup("org.jetbrains.intellij.platform")
            }
        }
        mavenCentral()
        gradlePluginPortal()
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies/")
    }
}
