import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    // PROVISIONAL: el nombre del paquete se decide antes de publicar en Play
    // Store (después ya no se puede cambiar). Cambiarlo aquí basta.
    namespace = "co.asistencia.kiosco"
    compileSdk = 36

    defaultConfig {
        applicationId = "co.asistencia.kiosco"
        minSdk = 26 // Android 8: cubre casi todos los celulares en uso
        targetSdk = 36 // Play Store exige apuntar a versiones recientes
        versionCode = 1
        versionName = "0.1.0-prototipo"
        // El MISMO servidor del kiosco web: ninguna ruta nueva.
        buildConfigField("String", "SERVIDOR", "\"https://arrivecontrol.vercel.app\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // Los modelos ya vienen comprimidos o casi no comprimen: sin comprimir en
    // el APK se leen directo (mmap), sin gastar CPU descomprimiendo 17 MB.
    androidResources {
        noCompress += listOf("onnx", "task")
    }
    packaging {
        // Librerías nativas sin comprimir y alineadas (páginas de 16 KB,
        // requisito de Play Store para Android 15+).
        jniLibs { useLegacyPackaging = false }
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

// Los modelos son los MISMOS archivos que usa la web (face_landmarker.task y
// ArcFace w600k_mbf.onnx): se copian de attendance-prototype/public/models en
// cada compilación. Así los rostros ya registrados siguen sirviendo.
val copiarModelos by tasks.registering(Copy::class) {
    from("../../attendance-prototype/public/models") {
        include("face_landmarker.task")
        include("v2/w600k_mbf.onnx")
    }
    into(layout.projectDirectory.dir("src/main/assets/modelos"))
}
tasks.named("preBuild") { dependsOn(copiarModelos) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")

    val camerax = "1.4.2"
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-view:$camerax")

    // Detección de cara, puntos y parpadeo (la misma familia de MediaPipe de la web).
    implementation("com.google.mediapipe:tasks-vision:0.10.26")
    // ArcFace: el mismo modelo ONNX que la web.
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
