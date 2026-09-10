# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# --- The portal password's vault -------------------------------------------
#
# EncryptedSharedPreferences pulls in Tink, which is compiled against
# annotations it does not ship: `javax.annotation.concurrent.GuardedBy` is a
# compile-time contract with no runtime class behind it. R8 refuses to finish
# while a referenced class is missing, so the release build failed where the
# debug build - which does not run R8 - passed. That asymmetry is the whole
# reason this line is worth a comment: the vault worked perfectly on the
# emulator and could still not be shipped.
#
# `-dontwarn` rather than `-keep`: the class genuinely is not needed at
# runtime, and this is exactly the rule R8 itself generated in
# build/outputs/mapping/universalRelease/missing_rules.txt.
-dontwarn javax.annotation.concurrent.GuardedBy

# The Kotlin half of the vault is found BY NAME, not by a reference R8 can see.
#
# `register_android_plugin("cv.codedrichy.targetx", "CredsPlugin")` in creds.rs
# resolves the class reflectively, and the @Command methods are dispatched the
# same way. To R8 nothing in the app calls any of it, so without these rules it
# is free to rename or delete the lot - and the failure would be invisible in
# testing that does not run R8: the debug build has no shrinker, so the vault
# works there and silently stops working in the build students install.
#
# tauri-android ships no consumer rules for this, so it is on us.
-keep class cv.codedrichy.targetx.CredsPlugin { *; }
-keep @app.tauri.annotation.TauriPlugin class * { *; }
-keepclassmembers class * {
    @app.tauri.annotation.Command <methods>;
}
# The @InvokeArg classes are populated by deserialising the payload into their
# fields, which is another thing R8 cannot see being used.
-keep class cv.codedrichy.targetx.SaveArgs { *; }
-keep class cv.codedrichy.targetx.BaseArgs { *; }
