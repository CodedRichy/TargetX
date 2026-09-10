package cv.codedrichy.targetx

import android.app.Activity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

/**
 * The portal password, on Android.
 *
 * The desktop build keeps this in the OS credential vault and the phone kept it
 * nowhere: `canRemember` was gated to the desktop shell, `creds.rs` compiled a
 * Windows-only backend, and so on a phone there was no vault to save into.
 *
 * That was not merely a missing convenience. Nothing in the app can refresh
 * itself without a stored login - `autosync.ts` reads the vault and returns
 * "no-creds" when it is empty - so on Android the refresh button contacted no
 * portal, ever, and reopening the app never brought anything new down. The
 * button spun and stopped. That is issue #16.
 *
 * EncryptedSharedPreferences rather than a file we encrypt ourselves: the key
 * lives in the Android Keystore, which on any device made this decade is
 * hardware-backed, so the bytes on disk are useless without the device and the
 * app's own signature. Keys are encrypted as well as values, so the file does
 * not even leak which colleges a student has logged into.
 *
 * The same promise the desktop makes holds here: this store is the ONLY place
 * the password goes. Never `state.json`, never the export, never a log. The
 * plugin returns the password to Rust and Rust hands it to one request.
 */
@InvokeArg
class SaveArgs {
    lateinit var base: String
    lateinit var username: String
    lateinit var password: String
}

@InvokeArg
class BaseArgs {
    lateinit var base: String
}

@TauriPlugin
class CredsPlugin(private val activity: Activity) : Plugin(activity) {

    /**
     * Opened lazily and kept, because creating it derives a Keystore key and
     * that is not free. A failure here is reported to the caller rather than
     * thrown into the void: Rust turns it into the same "vault unavailable"
     * that the desktop already knows how to survive.
     */
    private val prefs by lazy {
        val alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        EncryptedSharedPreferences.create(
            STORE,
            alias,
            activity.applicationContext,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @Command
    fun save(invoke: Invoke) {
        val args = invoke.parseArgs(SaveArgs::class.java)
        val entry = JSONObject()
            .put("username", args.username)
            .put("password", args.password)
        prefs.edit().putString(args.base, entry.toString()).apply()
        invoke.resolve()
    }

    /**
     * Resolves with `found: false` rather than rejecting when there is nothing
     * stored. "No saved login" is an ordinary state - most students never tick
     * the box - and an error would make the caller treat it as a fault.
     */
    @Command
    fun load(invoke: Invoke) {
        val args = invoke.parseArgs(BaseArgs::class.java)
        val raw = prefs.getString(args.base, null)
        val out = JSObject()
        if (raw == null) {
            out.put("found", false)
        } else {
            val entry = JSONObject(raw)
            out.put("found", true)
            out.put("username", entry.optString("username"))
            out.put("password", entry.optString("password"))
        }
        invoke.resolve(out)
    }

    @Command
    fun delete(invoke: Invoke) {
        val args = invoke.parseArgs(BaseArgs::class.java)
        prefs.edit().remove(args.base).apply()
        invoke.resolve()
    }

    @Command
    fun has(invoke: Invoke) {
        val args = invoke.parseArgs(BaseArgs::class.java)
        val out = JSObject()
        out.put("found", prefs.contains(args.base))
        invoke.resolve(out)
    }

    private companion object {
        /** The encrypted file. One store, keyed per portal base URL. */
        const val STORE = "targetx-portal-creds"
    }
}
