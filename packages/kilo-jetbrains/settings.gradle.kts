rootProject.name = "kilo.jetbrains"

include("shared")
include("frontend")
include("backend")

pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies/")
    }
}
