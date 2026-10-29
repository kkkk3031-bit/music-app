package com.khaled.cadence

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.abs

/**
 * App-side handle on the PlaybackService player (via MediaController), plus
 * listen-together sync: while in a room the room state drives playback.
 */
object Playback {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var controller: MediaController? = null
    private val tracks = mutableMapOf<String, Track>()

    val current = MutableStateFlow<Track?>(null)
    val isPlaying = MutableStateFlow(false)
    val positionMs = MutableStateFlow(0L)
    val durationMs = MutableStateFlow(0L)
    val shuffle = MutableStateFlow(false)
    val repeat = MutableStateFlow(Player.REPEAT_MODE_OFF)
    val queue = MutableStateFlow<List<Track>>(emptyList())
    val index = MutableStateFlow(-1)
    val message = MutableStateFlow<String?>(null)

    // Room mode
    var inRoom = false
        private set
    private var roomTrackId: String? = null
    private var roomPlayback: JSONObject? = null

    fun connect(context: Context) {
        if (controller != null) return
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        scope.launch {
            val c = MediaController.Builder(context, token).buildAsync().await()
            controller = c
            c.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) = refresh()
                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    val id = mediaItem?.mediaId ?: return
                    if (!inRoom) scope.launch { Api.played(id) }
                }
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED && inRoom && RoomClient.isHost) RoomClient.control("room:next")
                }
            })
            refresh()
        }
        scope.launch {
            while (true) {
                controller?.let {
                    positionMs.value = it.currentPosition
                    durationMs.value = it.duration.takeIf { d -> d > 0 } ?: ((current.value?.duration ?: 0) * 1000L)
                }
                delay(500)
            }
        }
        scope.launch {
            while (true) {
                delay(2000)
                if (inRoom) correctDrift(false)
            }
        }
    }

    private fun refresh() {
        val c = controller ?: return
        isPlaying.value = c.isPlaying
        shuffle.value = c.shuffleModeEnabled
        repeat.value = c.repeatMode
        val items = (0 until c.mediaItemCount).mapNotNull { tracks[c.getMediaItemAt(it).mediaId] }
        queue.value = items
        index.value = c.currentMediaItemIndex
        current.value = c.currentMediaItem?.mediaId?.let { tracks[it] }
    }

    private fun item(t: Track): MediaItem {
        tracks[t.id] = t
        val meta = MediaMetadata.Builder().setTitle(t.title).setArtist(t.artist).setAlbumTitle(t.album)
        Api.abs(t.cover)?.let { meta.setArtworkUri(Uri.parse(it)) }
        return MediaItem.Builder().setMediaId(t.id).setUri(Api.streamUrl(t)).setMediaMetadata(meta.build()).build()
    }

    private fun toast(msg: String) {
        message.value = msg
    }

    // ---------- local queue ----------
    fun playList(list: List<Track>, start: Int) {
        if (list.isEmpty()) return
        scope.launch {
            try {
                if (inRoom) {
                    val t = Api.ensureTrack(list[start])
                    if (RoomClient.isHost) RoomClient.control("room:play", JSONObject().put("trackId", t.id).put("position", 0))
                    else addToQueue(t)
                    return@launch
                }
                // Only resolve online results that are actually going to be queued.
                val resolved = list.map { if (it.remote != null) Api.ensureTrack(it) else it }
                val c = controller ?: return@launch
                c.setMediaItems(resolved.map(::item), start, 0)
                c.prepare()
                c.play()
            } catch (e: Exception) {
                toast(e.message ?: "Can't play")
            }
        }
    }

    fun addToQueue(t: Track) {
        scope.launch {
            try {
                val track = Api.ensureTrack(t)
                if (inRoom) {
                    RoomClient.control("room:queue:add", JSONObject().put("trackId", track.id))
                    toast("Added to room queue")
                    return@launch
                }
                val c = controller ?: return@launch
                if (c.mediaItemCount == 0) return@launch playList(listOf(track), 0)
                c.addMediaItem(item(track))
                toast("Added to queue")
            } catch (e: Exception) {
                toast(e.message ?: "Failed")
            }
        }
    }

    fun jumpTo(i: Int) {
        if (inRoom) return
        controller?.seekTo(i, 0)
        controller?.play()
    }

    fun removeAt(i: Int) {
        if (!inRoom && i != index.value) controller?.removeMediaItem(i)
    }

    private fun hostOnly(): Boolean {
        if (inRoom && !RoomClient.isHost) {
            toast("Only the room host controls playback")
            return false
        }
        return true
    }

    fun toggle() {
        val c = controller ?: return
        if (inRoom) {
            if (!hostOnly()) return
            val pb = roomPlayback ?: return
            val pos = c.currentPosition / 1000.0
            RoomClient.control(if (pb.optBoolean("playing")) "room:pause" else "room:resume", JSONObject().put("position", pos))
            return
        }
        if (c.isPlaying) c.pause() else c.play()
    }

    fun next() {
        if (inRoom) { if (hostOnly()) RoomClient.control("room:next"); return }
        controller?.seekToNextMediaItem()
    }

    fun prev() {
        if (inRoom) { seekTo(0); return }
        val c = controller ?: return
        if (c.currentPosition > 3000 || !c.hasPreviousMediaItem()) c.seekTo(0) else c.seekToPreviousMediaItem()
    }

    fun seekTo(ms: Long) {
        if (inRoom) {
            if (hostOnly()) RoomClient.control("room:seek", JSONObject().put("position", ms / 1000.0))
            return
        }
        controller?.seekTo(ms)
    }

    fun toggleShuffle() {
        if (inRoom) return
        controller?.let { it.shuffleModeEnabled = !it.shuffleModeEnabled }
    }

    fun cycleRepeat() {
        if (inRoom) return
        controller?.let {
            it.repeatMode = when (it.repeatMode) {
                Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                else -> Player.REPEAT_MODE_OFF
            }
        }
    }

    fun setLiked(id: String, liked: Boolean) {
        tracks[id]?.let { tracks[id] = it.copy(liked = liked) }
        refresh()
    }

    // ---------- rooms ----------
    fun enterRoom() {
        if (!inRoom) {
            inRoom = true
            controller?.run {
                pause()
                clearMediaItems()
                shuffleModeEnabled = false
                repeatMode = Player.REPEAT_MODE_OFF
            }
            roomTrackId = null
        }
    }

    fun leaveRoom() {
        inRoom = false
        roomTrackId = null
        roomPlayback = null
        controller?.run {
            pause()
            clearMediaItems()
        }
        refresh()
    }

    private fun expectedMs(): Long {
        val pb = roomPlayback ?: return 0
        val pos = pb.optDouble("position", 0.0)
        val at = pb.optLong("at", 0)
        val secs = if (pb.optBoolean("playing")) pos + ((RoomClient.serverNow() - at).coerceAtLeast(0)) / 1000.0 else pos
        return (secs * 1000).toLong()
    }

    /** Called on the main thread with each room:state playback object. */
    fun syncTo(playback: JSONObject) {
        val c = controller ?: return
        roomPlayback = playback
        val trackJson = playback.optJSONObject("track")
        if (trackJson == null) {
            roomTrackId = null
            c.pause()
            c.clearMediaItems()
            refresh()
            return
        }
        val t = Track.from(trackJson)
        if (t.id != roomTrackId) {
            roomTrackId = t.id
            c.setMediaItem(item(t), expectedMs())
            c.prepare()
            c.playWhenReady = playback.optBoolean("playing")
        } else correctDrift(true)
        refresh()
    }

    private fun correctDrift(force: Boolean) {
        val c = controller ?: return
        val pb = roomPlayback ?: return
        if (roomTrackId == null || c.playbackState == Player.STATE_IDLE) return
        val want = expectedMs()
        val diff = abs(c.currentPosition - want)
        val playing = pb.optBoolean("playing")
        if (diff > 1000 || (force && diff > 350)) c.seekTo(want)
        if (playing && !c.playWhenReady) c.play()
        if (!playing && c.playWhenReady) c.pause()
    }
}
