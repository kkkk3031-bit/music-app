package com.khaled.cadence

import org.json.JSONArray
import org.json.JSONObject

data class Track(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Int,
    val cover: String?,
    val streamUrl: String,
    val type: String,
    val source: String,
    val ownerId: String?,
    val liked: Boolean,
    /** Set for online search results that haven't been saved as tracks yet. */
    val remote: JSONObject? = null,
) {
    companion object {
        fun from(o: JSONObject) = Track(
            id = o.getString("id"),
            title = o.optString("title", "Untitled"),
            artist = o.optString("artist", ""),
            album = o.optString("album", ""),
            duration = o.optInt("duration", 0),
            cover = o.optStringOrNull("cover"),
            streamUrl = o.optString("streamUrl", ""),
            type = o.optString("type", "local"),
            source = o.optString("source", ""),
            ownerId = o.optJSONObject("owner")?.optString("id"),
            liked = o.optBoolean("liked", false),
        )

        fun remote(o: JSONObject) = Track(
            id = "remote:" + o.getString("url"),
            title = o.optString("title", "Untitled"),
            artist = o.optString("artist", ""),
            album = o.optString("album", ""),
            duration = o.optInt("duration", 0),
            cover = o.optStringOrNull("cover"),
            streamUrl = "",
            type = "remote",
            source = o.optString("source", ""),
            ownerId = null,
            liked = false,
            remote = o,
        )
    }
}

data class Playlist(
    val id: String,
    val name: String,
    val description: String,
    val cover: String?,
    val ownerId: String,
    val ownerName: String,
    val trackCount: Int,
    val tracks: List<Track>,
) {
    companion object {
        fun from(o: JSONObject) = Playlist(
            id = o.getString("id"),
            name = o.optString("name"),
            description = o.optString("description"),
            cover = o.optStringOrNull("cover"),
            ownerId = o.optJSONObject("owner")?.optString("id") ?: "",
            ownerName = o.optJSONObject("owner")?.optString("username") ?: "",
            trackCount = o.optInt("trackCount"),
            tracks = o.optJSONArray("tracks")?.mapObjects(Track::from) ?: emptyList(),
        )
    }
}

data class DownloadJob(val id: String, val title: String, val status: String, val progress: Double, val error: String?) {
    companion object {
        fun from(o: JSONObject) = DownloadJob(
            o.getString("id"), o.optString("title", o.optString("url")), o.optString("status"),
            o.optDouble("progress", 0.0), o.optStringOrNull("error"),
        )
    }
}

fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

fun <T> JSONArray.mapObjects(fn: (JSONObject) -> T): List<T> = (0 until length()).map { fn(getJSONObject(it)) }

fun formatTime(seconds: Long): String {
    val s = seconds.coerceAtLeast(0)
    val h = s / 3600
    val m = (s % 3600) / 60
    val sec = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%d:%02d".format(m, sec)
}
