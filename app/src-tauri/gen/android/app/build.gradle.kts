import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

/*
 * Release signing, read from a file that is NOT in this repository.
 *
 * `keystore.properties` sits beside this build script, is listed in
 * `.gitignore`, and holds four values: `storeFile`, `storePassword`,
 * `keyAlias`, `keyPassword`. `docs/ANDROID-SIGNING.md` has the one command
 * that creates it and the reasons it must be backed up.
 *
 * Absent, this is empty and release builds come out UNSIGNED rather than
 * failing - which is what happens on any machine that does not have the key,
 * CI included. A build that stops dead because a secret is missing is a build
 * nobody else can run; an unsigned APK announces the problem at install time,
 * to the one person who could fix it.
 */
val keystoreProperties = Properties().apply {
    val propFile = file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
val hasSigningKey = keystoreProperties.getProperty("storeFile") != null

android {
    compileSdk = 36
    namespace = "cv.codedrichy.targetx"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "cv.codedrichy.targetx"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (hasSigningKey) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            // Native debug symbols are NOT kept, which is a change from what
            // `tauri android init` generates.
            //
            // Rust's debug build carries its symbols inside the .so, and for
            // this crate that is the whole APK: 161 MB with them, and the
            // emulator refuses the install ("Requested internal only, but not
            // enough space") because a stock AVD does not have room for the
            // package plus its extraction.
            //
            // What this costs is symbolicated NATIVE stack traces in a debug
            // build - Rust panics are already logged with their own message
            // through `log_error`/the panic hook in `lib.rs`, and the Kotlin
            // and JS halves are unaffected. Add a line back temporarily if a
            // native crash ever needs chasing in `ndk-stack`.
            packaging {
                jniLibs.keepDebugSymbols.clear()
            }
        }
        getByName("release") {
            // Only when there is a key to sign with. See `keystoreProperties`.
            if (hasSigningKey) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    // Holds the system splash on screen until the page has actually drawn.
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")