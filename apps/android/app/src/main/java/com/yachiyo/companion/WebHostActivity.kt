package com.yachiyo.companion

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.util.Log
import com.yachiyo.companion.bridge.YachiyoNativeBridge
import com.yachiyo.companion.features.NativeFeatures
import com.yachiyo.companion.web.WebAssets
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.webkit.WebViewAssetLoader

/** Full-screen immersive WebView host shared by the main and lockscreen activities. */
abstract class WebHostActivity : Activity() {
    /** "normal" or "lockscreen" (contract C1.3 `mode`). */
    abstract val mode: String

    protected lateinit var webView: WebView
    protected lateinit var assetLoader: WebViewAssetLoader
    @Volatile protected var pageFinished = false
    lateinit var bridge: YachiyoNativeBridge
        private set
    val features: NativeFeatures by lazy { NativeFeatures(this) }

    protected open fun pluginsEnabled(): Boolean = mode == "normal"
    protected open fun extraPathHandler(): WebViewAssetLoader.PathHandler? = null
    protected open fun onWebViewReady(view: WebView) {}
    protected open fun onPageFinishedHook() {}
    /** Home/launcher activities swallow the back key instead of leaving. */
    protected open val swallowBack: Boolean get() = false
    protected open fun entryUrl(): String = WebAssets.entryUrl(this, mode)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.BLACK))

        assetLoader = WebAssets.buildLoader(this, ::pluginsEnabled, extraPathHandler())
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                setSupportZoom(false)
                builtInZoomControls = false
            }
            webViewClient = HostClient()
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                    Log.d("YachiyoWebConsole", "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                    return true
                }
            }
        }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        setContentView(webView)
        applyImmersive()
        bridge = YachiyoNativeBridge(this, webView)
        webView.addJavascriptInterface(bridge.gate, "__YachiyoBridge")
        bridge.attach()
        registerReceiver(screenState, android.content.IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON)
        }, android.content.Context.RECEIVER_NOT_EXPORTED)
        applyOrientation(CompanionApp.instance.config.get().optString("orientation", "auto"), persist = false)
        onWebViewReady(webView)
        if (savedInstanceState == null) webView.loadUrl(entryUrl())
        else webView.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersive()
    }

    @Suppress("DEPRECATION")
    protected fun applyImmersive() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        features.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        features.onPermissionResult(requestCode, grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
    }

    private val screenState = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context, intent: Intent) {
            bridge.emitLifecycle(if (intent.action == Intent.ACTION_SCREEN_OFF) "screen_off" else "screen_on")
        }
    }

    override fun onResume() {
        super.onResume()
        bridge.emitLifecycle("resume")
    }

    override fun onPause() {
        bridge.stopServerDiscoveryForLifecycle()
        bridge.emitLifecycle("pause")
        super.onPause()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (swallowBack || pageFinished) bridge.requestBack() else defaultBack()
    }

    /** Fallback behaviour when the Web layer does not consume the back key within 300 ms. */
    open fun defaultBack() {
        if (swallowBack) return
        if (this is SettingsActivity) finish() else moveTaskToBack(true)
    }

    fun isDefaultLauncher(): Boolean {
        if (Build.VERSION.SDK_INT >= 29) {
            val rm = getSystemService(android.app.role.RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(android.app.role.RoleManager.ROLE_HOME))
                return rm.isRoleHeld(android.app.role.RoleManager.ROLE_HOME)
        }
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val ri = packageManager.resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY)
        return ri?.activityInfo?.packageName == packageName
    }

    open fun openSettingsScreen() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    open fun closeSettingsScreen() {
        if (this is SettingsActivity) finish()
    }

    fun openHomeSettings() {
        try { startActivity(Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (e: Exception) { startActivity(Intent(Settings.ACTION_SETTINGS)) }
    }

    fun launchApp(pkg: String) {
        val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** mode: auto | portrait | landscape. Activity is not recreated (see configChanges). */
    fun applyOrientation(mode: String, persist: Boolean) {
        requestedOrientation = when (mode) {
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            else -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
        }
        if (persist) CompanionApp.instance.config.set(org.json.JSONObject().put("orientation", mode).toString())
    }

    override fun onDestroy() {
        try { unregisterReceiver(screenState) } catch (_: Exception) {}
        bridge.detach()
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    private inner class HostClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            // C2.0: reset the handshake when the main document is requested, i.e. BEFORE its scripts
            // can run (onPageStarted is delivered asynchronously and may arrive after them).
            if (request.isForMainFrame) bridge.gate.reset()
            return assetLoader.shouldInterceptRequest(request.url)
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            pageFinished = false
            bridge.dispatcher.markNotReady()
        }

        override fun onPageFinished(view: WebView, url: String?) {
            pageFinished = true
            bridge.onPageFinished()
            onPageFinishedHook()
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // keep navigation inside the asset origin; everything else is blocked
            return request.url.host != WebAssets.HOST
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.e("YachiyoShell", "WebView render process gone (crashed=${detail.didCrash()}); recreating")
            recreate()
            return true
        }
    }
}
