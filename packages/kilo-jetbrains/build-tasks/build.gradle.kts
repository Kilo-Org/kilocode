plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
}

gradlePlugin {
    plugins {
        create("build-tasks") {
            id = "build-tasks"
            implementationClass = "BuildTasksPlugin"
        }
    }
}
