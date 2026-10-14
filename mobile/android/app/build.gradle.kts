import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.ly.creatoros.ly_creator_capture"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.ly.creatoros.ly_creator_capture"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 31
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    val privateSigningPropertiesFile = rootProject.file(
        ".private-signing/private-signing.properties",
    )
    val privateSigningProperties = Properties()
    if (privateSigningPropertiesFile.isFile) {
        privateSigningPropertiesFile.inputStream().use(
            privateSigningProperties::load,
        )
    }

    signingConfigs {
        if (privateSigningPropertiesFile.isFile) {
            create("privateRelease") {
                storeFile = rootProject.file(
                    privateSigningProperties.getProperty("storeFile"),
                )
                storePassword = privateSigningProperties.getProperty("storePassword")
                keyAlias = privateSigningProperties.getProperty("keyAlias")
                keyPassword = privateSigningProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (privateSigningPropertiesFile.isFile) {
                signingConfigs.getByName("privateRelease")
            } else {
                signingConfigs.getByName("debug")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

val releaseRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}
if (
    releaseRequested &&
    !rootProject.file(".private-signing/private-signing.properties").isFile &&
    System.getenv("LY_ALLOW_DEBUG_RELEASE") != "1"
) {
    throw GradleException(
        "私人release签名尚未初始化；先运行mobile/scripts/create-private-signing.sh",
    )
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.exifinterface:exifinterface:1.4.1")
    implementation("androidx.work:work-runtime:2.10.2")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit-ktx:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
