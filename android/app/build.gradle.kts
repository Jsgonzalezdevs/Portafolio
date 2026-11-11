plugins {
    id("com.android.application")
}

android {
    namespace = "lat.juliangonzalez.asistente"
    compileSdk = 36

    defaultConfig {
        applicationId = "lat.juliangonzalez.asistente"
        // Android 6.0 (Lenovo YT3-850F).
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        // La YT3-850F es ARM; sin x86 el APK pesa menos.
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a") }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Palabra clave en el dispositivo: pocos MB de RAM y poca CPU (Snapdragon 210).
    implementation("ai.picovoice:porcupine-android:4.0.2")
}
