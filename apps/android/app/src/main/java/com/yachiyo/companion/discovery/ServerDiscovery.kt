package com.yachiyo.companion.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.util.ArrayDeque

data class DiscoveredServer(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    val path: String,
    val version: String
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("name", name)
        .put("host", host)
        .put("port", port)
        .put("path", path)
        .put("version", version)
}

/** Pure validation and address selection for C7 DNS-SD results. */
object DiscoveryCandidate {
    fun from(
        name: String,
        port: Int,
        attributes: Map<String, ByteArray>,
        addresses: List<InetAddress>
    ): DiscoveredServer? {
        if (name.isBlank() || port !in 1..65535) return null
        val version = attributes["version"]?.toString(StandardCharsets.UTF_8) ?: return null
        val path = attributes["path"]?.toString(StandardCharsets.UTF_8) ?: return null
        if (version != "1" || path != "/ws/device") return null
        val address = addresses.firstOrNull { it is Inet4Address } ?: addresses.firstOrNull() ?: return null
        val host = address.hostAddress?.removePrefix("[")?.removeSuffix("]").orEmpty()
        if (host.isBlank()) return null
        return DiscoveredServer(name, name, host, port, path, version)
    }
}

/** Owns a single discovery listener generation so cancelled scans ignore late platform callbacks. */
internal class DiscoverySession<L> {
    private var generation = 0
    var listener: L? = null
        private set
    var scanning = false
        private set

    fun start(createListener: (Int) -> L): Pair<Int, L>? {
        if (scanning) return null
        generation++
        val next = createListener(generation)
        listener = next
        scanning = true
        return generation to next
    }

    fun active(callbackGeneration: Int): Boolean = scanning && generation == callbackGeneration

    /** Invalidates callbacks before returning the listener that the platform must stop. */
    fun cancel(): L? {
        generation++
        val old = listener.takeIf { scanning }
        listener = null
        scanning = false
        return old
    }
}

/** One-settings-page Android NSD scan. All mutation is serialized on the main looper. */
class ServerDiscovery(
    context: Context,
    private val emit: (String, JSONObject) -> Unit,
    private val timeoutMs: Long = 10_000L
) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val nsd = app.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val services = linkedMapOf<String, DiscoveredServer>()
    private val seenNames = linkedSetOf<String>()
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private var resolvingName: String? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private val session = DiscoverySession<NsdManager.DiscoveryListener>()

    private val timeout = Runnable { stopNow(REASON_TIMEOUT) }

    fun start() = main.post {
        if (session.scanning) return@post
        services.clear()
        seenNames.clear()
        resolveQueue.clear()
        resolvingName = null
        emitResults()
        try {
            multicastLock = wifi?.createMulticastLock("yachiyo-server-discovery")?.apply {
                setReferenceCounted(false)
                acquire()
            }
            val (gen, next) = session.start(::discoveryListener) ?: return@post
            emitState("scanning")
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, next)
            main.postDelayed(timeout, timeoutMs)
        } catch (e: SecurityException) {
            fail(REASON_PERMISSION_DENIED, e)
        } catch (e: Exception) {
            fail(REASON_UNAVAILABLE, e)
        }
    }

    fun stop(reason: String = REASON_MANUAL) = main.post { stopNow(reason) }

    private fun stopNow(reason: String) {
        main.removeCallbacks(timeout)
        val old = session.cancel()
        resolveQueue.clear()
        resolvingName = null
        if (old != null) {
            try { nsd.stopServiceDiscovery(old) }
            catch (e: SecurityException) { releaseLock(); emitState("error", REASON_PERMISSION_DENIED, e.message); return }
            catch (e: Exception) { releaseLock(); emitState("error", REASON_UNAVAILABLE, e.message); return }
        }
        releaseLock()
        emitState("stopped", reason)
    }

    private fun discoveryListener(gen: Int) = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) = Unit

        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
            main.post {
                if (!active(gen) || !serviceInfo.serviceType.startsWith("_yachiyo._tcp")) return@post
                val name = serviceInfo.serviceName.orEmpty()
                if (name.isBlank() || !seenNames.add(name)) return@post
                resolveQueue.add(serviceInfo)
                resolveNext(gen)
            }
        }

        override fun onServiceLost(serviceInfo: NsdServiceInfo) {
            main.post {
                if (!active(gen)) return@post
                val name = serviceInfo.serviceName.orEmpty()
                seenNames.remove(name)
                resolveQueue.removeAll { it.serviceName == name }
                if (services.remove(name) != null) emitResults()
            }
        }

        override fun onDiscoveryStopped(serviceType: String) = Unit

        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
            main.post {
                if (active(gen)) fail(REASON_UNAVAILABLE, IllegalStateException("NSD start failed ($errorCode)"))
            }
        }

        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
            // stopNow() already invalidated this generation. Record the platform failure without
            // changing UI state or restarting discovery from a late callback.
            Log.w(TAG, "NSD stop failed ($errorCode) for $serviceType")
        }
    }

    @Suppress("DEPRECATION")
    private fun resolveNext(gen: Int) {
        if (!active(gen) || resolvingName != null) return
        val info = resolveQueue.poll() ?: return
        val name = info.serviceName.orEmpty()
        if (!seenNames.contains(name)) { resolveNext(gen); return }
        resolvingName = name
        try {
            nsd.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    main.post {
                        if (!active(gen) || resolvingName != name) return@post
                        resolvingName = null
                        resolveNext(gen)
                    }
                }

                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    main.post {
                        if (!active(gen) || resolvingName != name) return@post
                        resolvingName = null
                        if (seenNames.contains(name)) {
                            val candidate = DiscoveryCandidate.from(
                                name,
                                serviceInfo.port,
                                serviceInfo.attributes,
                                addresses(serviceInfo)
                            )
                            if (candidate != null) {
                                services[name] = candidate
                                emitResults()
                            }
                        }
                        resolveNext(gen)
                    }
                }
            })
        } catch (e: SecurityException) {
            fail(REASON_PERMISSION_DENIED, e)
        } catch (e: Exception) {
            resolvingName = null
            resolveNext(gen)
        }
    }

    @Suppress("DEPRECATION")
    private fun addresses(info: NsdServiceInfo): List<InetAddress> =
        if (Build.VERSION.SDK_INT >= 34) info.hostAddresses else listOfNotNull(info.host)

    private fun active(gen: Int) = session.active(gen)

    private fun fail(reason: String, error: Exception) {
        main.removeCallbacks(timeout)
        val old = session.cancel()
        resolveQueue.clear()
        resolvingName = null
        if (old != null) {
            // Start/resolve failures can happen after the platform accepted discovery. Always ask
            // NSD to release that listener; it may reject the stop if start itself never completed.
            try { nsd.stopServiceDiscovery(old) } catch (_: Exception) {}
        }
        releaseLock()
        emitState("error", reason, error.message ?: error.javaClass.simpleName)
    }

    private fun releaseLock() {
        try { multicastLock?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
        multicastLock = null
    }

    private fun emitResults() = emit("server.discovery.results", JSONObject()
        .put("services", JSONArray(services.values.map { it.toJson() })))

    private fun emitState(state: String, reason: String? = null, error: String? = null) {
        val data = JSONObject().put("state", state)
        if (reason != null) data.put("reason", reason)
        if (!error.isNullOrBlank()) data.put("error", error)
        emit("server.discovery.state", data)
    }

    companion object {
        private const val TAG = "ServerDiscovery"
        const val SERVICE_TYPE = "_yachiyo._tcp."
        const val REASON_MANUAL = "manual"
        const val REASON_TIMEOUT = "timeout"
        const val REASON_LIFECYCLE = "lifecycle"
        const val REASON_PERMISSION_DENIED = "permission_denied"
        const val REASON_UNAVAILABLE = "unavailable"
    }
}
