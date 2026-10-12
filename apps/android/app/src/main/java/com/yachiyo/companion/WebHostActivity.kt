package com.yachiyo.companion

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
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
import com.yachiyo.companion.web.WebAssets
import androidx.webkit.WebViewAssetLoader

/** Full-screen immersive WebView host shared by the main and lockscreen activities. */
abstract class WebHostActivity : Activity() {
    /** "normal" or "lockscreen" (contract C1.3 `mode`). */
    abstract val mode: String

    protected lateinit var webView: WebView
    protected lateinit var assetLoader: WebViewAssetLoader
    @Volatile protected var pageFinished = false

    protected open fun pluginsEnabled(): Boolean = mode == "normal"
    protected open fun extraPathHandler(): WebViewAssetLoader.PathHandler? = null
    protected open fun onWebViewReady(view: WebView) {}
    protected open fun onPageFinishedHook() {}
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
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
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

    override fun onDestroy() {
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    private inner class HostClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assetLoader.shouldInterceptRequest(request.url)

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            pageFinished = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
            pageFinished = true
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
