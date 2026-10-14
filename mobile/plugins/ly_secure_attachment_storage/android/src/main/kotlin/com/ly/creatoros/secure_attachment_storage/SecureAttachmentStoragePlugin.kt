package com.ly.creatoros.secure_attachment_storage

import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.PowerManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Network
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import android.os.Handler
import android.os.Looper
import java.io.File
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

class SecureAttachmentStoragePlugin :
    FlutterPlugin,
    MethodChannel.MethodCallHandler {
    private lateinit var attachmentChannel: MethodChannel
    private lateinit var shareChannel: MethodChannel
    private lateinit var deviceChannel: MethodChannel
    private lateinit var networkChannel: MethodChannel
    private lateinit var store: EncryptedAttachmentStore
    private lateinit var shareQueue: ShareQueueBridge
    private lateinit var applicationContext: Context
    companion object {
        private var boundWifi: Network? = null
        private var bindingCount = 0
    }
    private var ownedBindings = 0
    private var connectivityCallback: ConnectivityManager.NetworkCallback? = null
    private fun connectivity() = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private fun wifiNetwork(): Network? {
        val manager = connectivity()
        return manager.allNetworks.firstOrNull {
            val caps = manager.getNetworkCapabilities(it)
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true && !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        }
    }
    private fun releaseWifi() {
        synchronized(SecureAttachmentStoragePlugin::class.java) {
            if (ownedBindings == 0) return
            ownedBindings--
            bindingCount--
            if (bindingCount == 0) { connectivity().bindProcessToNetwork(null); boundWifi = null }
        }
    }
    private fun stopNetworkEvents() {
        connectivityCallback?.let { connectivity().unregisterNetworkCallback(it) }
        connectivityCallback = null
    }
    private var multicastLock: WifiManager.MulticastLock? = null
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        applicationContext = binding.applicationContext
        store = EncryptedAttachmentStore(applicationContext)
        shareQueue = ShareQueueBridge(applicationContext)
        attachmentChannel = MethodChannel(
            binding.binaryMessenger,
            "ly.creator.capture/attachment_storage",
        )
        shareChannel = MethodChannel(
            binding.binaryMessenger,
            "ly.creator.capture/share_intake",
        )
        deviceChannel = MethodChannel(
            binding.binaryMessenger,
            "ly.creator.capture/device_status",
        )
        networkChannel = MethodChannel(
            binding.binaryMessenger,
            "ly.creator.capture/network",
        )
        attachmentChannel.setMethodCallHandler(this)
        shareChannel.setMethodCallHandler(this)
        deviceChannel.setMethodCallHandler(this)
        networkChannel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (call.method == "listPendingShares") {
            executor.execute {
                try {
                    val pending = shareQueue.listPending()
                    mainHandler.post { result.success(pending) }
                } catch (error: Exception) {
                    mainHandler.post {
                        result.error("share_queue_failed", error.message, null)
                    }
                }
            }
            return
        }
        if (call.method == "acknowledgeShare") {
            val shareId = call.argument<String>("shareId")
            if (shareId.isNullOrBlank()) {
                result.error("invalid_share", "系统分享标识无效", null)
                return
            }
            executor.execute {
                try {
                    shareQueue.acknowledge(shareId)
                    mainHandler.post { result.success(null) }
                } catch (error: Exception) {
                    mainHandler.post {
                        result.error("share_queue_failed", error.message, null)
                    }
                }
            }
            return
        }
        if (call.method == "startNetworkEvents") {
            if (connectivityCallback == null) {
                val callback = object : ConnectivityManager.NetworkCallback() {
                    private fun changed() { mainHandler.post { networkChannel.invokeMethod("networkChanged", null) } }
                    override fun onAvailable(network: Network) = changed()
                    override fun onLost(network: Network) = changed()
                    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = changed()
                }
                connectivityCallback = callback
                connectivity().registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), callback)
            }
            result.success(null)
            return
        }
        if (call.method == "stopNetworkEvents") { stopNetworkEvents(); result.success(null); return }
        if (call.method == "acquireLocalWifi") {
            synchronized(SecureAttachmentStoragePlugin::class.java) {
                val wifi = wifiNetwork()
                if (wifi == null || (bindingCount > 0 && boundWifi != wifi) || (bindingCount == 0 && !connectivity().bindProcessToNetwork(wifi))) {
                    result.success(false)
                } else {
                    boundWifi = wifi; bindingCount++; ownedBindings++; result.success(true)
                }
            }
            return
        }
        if (call.method == "releaseLocalWifi") { releaseWifi(); result.success(null); return }
        if (call.method == "getSyncEnvironment") {
            val connectivity = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val wifi = wifiNetwork()
            val capabilities = connectivity.getNetworkCapabilities(wifi)
            val battery = applicationContext.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val power = applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            result.success(mapOf(
                "wifi" to (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == false),
                "metered" to (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) != true),
                "powerSaver" to power.isPowerSaveMode,
                "batteryPercent" to battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100),
                "charging" to battery.isCharging,
            ))
            return
        }
        if (call.method == "getPower") {
            val manager = applicationContext.getSystemService(
                Context.BATTERY_SERVICE,
            ) as BatteryManager
            val level = manager.getIntProperty(
                BatteryManager.BATTERY_PROPERTY_CAPACITY,
            ).coerceIn(0, 100)
            val status = applicationContext.registerReceiver(
                null,
                android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED),
            )?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            result.success(
                mapOf(
                    "batteryPercent" to level,
                    "charging" to (
                        status == BatteryManager.BATTERY_STATUS_CHARGING ||
                            status == BatteryManager.BATTERY_STATUS_FULL
                        ),
                ),
            )
            return
        }
        if (call.method == "acquireMulticastLock") {
            val lock = multicastLock ?: (
                applicationContext.getSystemService(
                    Context.WIFI_SERVICE,
                ) as WifiManager
                ).createMulticastLock("ly.creator.capture.mdns").also {
                it.setReferenceCounted(false)
                multicastLock = it
            }
            if (!lock.isHeld) lock.acquire()
            result.success(null)
            return
        }
        if (call.method == "releaseMulticastLock") {
            multicastLock?.takeIf { it.isHeld }?.release()
            result.success(null)
            return
        }
        if (call.method == "updateWidgetPending") {
            val pendingCount = (
                call.argument<Number>("pendingCount")?.toInt() ?: 0
                ).coerceAtLeast(0)
            applicationContext.sendBroadcast(
                Intent("ly.creator.capture.UPDATE_WIDGET_PENDING")
                    .setPackage(applicationContext.packageName)
                    .putExtra("pendingCount", pendingCount),
            )
            result.success(null)
            return
        }
        val path = call.argument<String>("path")
        val attachmentId = call.argument<String>("attachmentId")
        if (path.isNullOrBlank() || attachmentId.isNullOrBlank()) {
            result.error("invalid_attachment", "附件读取参数无效", null)
            return
        }
        executor.execute {
            try {
                val file = File(path)
                val value: Any = when (call.method) {
                    "exists" -> file.exists()
                    "clearSize" -> store.clearSize(file)
                    "readChunk" -> {
                        val chunkIndex = call.argument<Int>("chunkIndex")
                            ?: throw IllegalArgumentException("附件分块序号缺失")
                        store.readChunk(file, attachmentId, chunkIndex)
                    }
                    "readPreview" -> {
                        val clearSize = store.clearSize(file)
                        if (clearSize > 5L * 1024 * 1024) {
                            throw IllegalArgumentException("附件预览大小无效")
                        }
                        val count = (
                            (clearSize + EncryptedAttachmentStore.clearChunkBytes - 1) /
                                EncryptedAttachmentStore.clearChunkBytes
                            ).toInt()
                        ByteArrayOutputStream(clearSize.toInt()).use { output ->
                            for (index in 0 until count) {
                                output.write(
                                    store.readChunk(
                                        file,
                                        attachmentId,
                                        index,
                                    ),
                                )
                            }
                            output.toByteArray()
                        }
                    }
                    else -> {
                        mainHandler.post { result.notImplemented() }
                        return@execute
                    }
                }
                mainHandler.post { result.success(value) }
            } catch (error: Exception) {
                mainHandler.post {
                    result.error("attachment_read_failed", error.message, null)
                }
            }
        }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        stopNetworkEvents()
        while (ownedBindings > 0) releaseWifi()
        attachmentChannel.setMethodCallHandler(null)
        shareChannel.setMethodCallHandler(null)
        deviceChannel.setMethodCallHandler(null)
        networkChannel.setMethodCallHandler(null)
        multicastLock?.takeIf { it.isHeld }?.release()
        multicastLock = null
        executor.shutdownNow()
    }
}
