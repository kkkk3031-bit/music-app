package com.khaled.cadence

import android.os.Handler
import android.os.Looper
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/** Socket.IO connection: listen-together rooms + live download progress. */
object RoomClient {
    private val main = Handler(Looper.getMainLooper())
    private var socket: Socket? = null
    private var clockOffset = 0L
    private var lastCode: String? = null

    val room = MutableStateFlow<JSONObject?>(null)
    val chat = MutableStateFlow<List<JSONObject>>(emptyList())
    val downloads = MutableStateFlow<JSONObject?>(null)
    val connected = MutableStateFlow(false)
    /** Latest direct message pushed by the server (sent or received). */
    val dm = MutableStateFlow<JSONObject?>(null)
    /** Bumped whenever the unread DM count may have changed. */
    val dmTick = MutableStateFlow(0)

    val isHost get() = room.value?.optString("hostId") == Api.userId

    fun serverNow() = System.currentTimeMillis() + clockOffset

    fun connect() {
        if (socket != null) return
        val opts = IO.Options.builder()
            .setAuth(mapOf("token" to (Api.token ?: "")))
            .setTransports(arrayOf(WebSocket.NAME))
            .build()
        val s = IO.socket(Api.baseUrl, opts)
        s.on(Socket.EVENT_CONNECT) {
            connected.value = true
            syncClock()
            lastCode?.let { code -> emit("room:join", JSONObject().put("code", code)) { r -> if (r.optBoolean("ok")) onJoined(r) } }
        }
        s.on(Socket.EVENT_DISCONNECT) { connected.value = false }
        s.on("room:state") { args -> (args.firstOrNull() as? JSONObject)?.let { st -> main.post { applyState(st) } } }
        s.on("room:chat") { args ->
            (args.firstOrNull() as? JSONObject)?.let { msg -> chat.value = (chat.value + msg).takeLast(200) }
        }
        s.on("dm") { args -> (args.firstOrNull() as? JSONObject)?.let { m -> main.post { dm.value = m; dmTick.value++ } } }
        s.on("dm:read") { main.post { dmTick.value++ } }
        s.on("download:update") { args -> (args.firstOrNull() as? JSONObject)?.let { downloads.value = it } }
        socket = s
        s.connect()
    }

    fun disconnect() {
        socket?.disconnect()
        socket?.off()
        socket = null
        room.value = null
        lastCode = null
    }

    /** NTP-style: keep the offset from the lowest-latency of a few pings. */
    private fun syncClock() {
        var bestRtt = Long.MAX_VALUE
        repeat(5) {
            val t0 = System.currentTimeMillis()
            socket?.emit("time", Ack { args ->
                val t1 = System.currentTimeMillis()
                val server = (args.firstOrNull() as? Number)?.toLong() ?: return@Ack
                val rtt = t1 - t0
                if (rtt < bestRtt) {
                    bestRtt = rtt
                    clockOffset = server - (t0 + t1) / 2
                }
            })
        }
    }

    private fun emit(event: String, payload: JSONObject, cb: (JSONObject) -> Unit) {
        val s = socket ?: return cb(JSONObject().put("ok", false).put("error", "Not connected"))
        s.emit(event, payload, Ack { args ->
            val r = args.firstOrNull() as? JSONObject ?: JSONObject().put("ok", false).put("error", "No response")
            main.post { cb(r) }
        })
    }

    suspend fun call(event: String, payload: JSONObject = JSONObject()): JSONObject {
        val d = CompletableDeferred<JSONObject>()
        emit(event, payload) { d.complete(it) }
        return withTimeoutOrNull(8000) { d.await() } ?: JSONObject().put("ok", false).put("error", "Server did not respond")
    }

    /** Fire-and-forget control; errors surface as a toast via Playback.message. */
    fun control(event: String, payload: JSONObject = JSONObject()) {
        emit(event, payload) { r -> if (!r.optBoolean("ok")) Playback.message.value = r.optString("error") }
    }

    private fun onJoined(r: JSONObject) {
        r.optJSONArray("chat")?.let { arr -> chat.value = (0 until arr.length()).map { arr.getJSONObject(it) } }
        r.optJSONObject("room")?.let { applyState(it) }
    }

    private fun applyState(st: JSONObject) {
        val wasHost = isHost
        room.value = st
        lastCode = st.optString("code")
        Playback.enterRoom()
        Playback.syncTo(st.getJSONObject("playback"))
        if (!wasHost && isHost) Playback.message.value = "You are now the host"
    }

    suspend fun create(name: String): String? {
        val r = call("room:create", JSONObject().put("name", name))
        if (!r.optBoolean("ok")) throw ApiException(400, r.optString("error"))
        chat.value = emptyList()
        r.optJSONObject("room")?.let { applyState(it) }
        return lastCode
    }

    suspend fun join(code: String) {
        val r = call("room:join", JSONObject().put("code", code.trim().uppercase()))
        if (!r.optBoolean("ok")) throw ApiException(400, r.optString("error"))
        onJoined(r)
    }

    suspend fun leave() {
        call("room:leave")
        lastCode = null
        room.value = null
        chat.value = emptyList()
        Playback.leaveRoom()
    }

    suspend fun sendChat(text: String) {
        val r = call("room:chat", JSONObject().put("text", text))
        if (!r.optBoolean("ok")) Playback.message.value = r.optString("error")
    }
}
