package com.khaled.cadence

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

class ApiException(val status: Int, message: String) : Exception(message)

/** REST client for the Cadence server (HttpURLConnection + org.json, no extra deps). */
object Api {
    private lateinit var prefs: SharedPreferences
    var onUnauthorized: () -> Unit = {}

    fun init(context: Context) {
        prefs = context.getSharedPreferences("cadence", Context.MODE_PRIVATE)
    }

    var baseUrl: String
        get() = prefs.getString("server", BuildConfig.DEFAULT_SERVER)!!.trimEnd('/')
        set(v) = prefs.edit().putString("server", v.trim().trimEnd('/')).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()

    var userId: String?
        get() = prefs.getString("userId", null)
        set(v) = prefs.edit().putString("userId", v).apply()

    var username: String?
        get() = prefs.getString("username", null)
        set(v) = prefs.edit().putString("username", v).apply()

    val signedIn get() = token != null

    fun abs(url: String?): String? = when {
        url.isNullOrEmpty() -> null
        url.startsWith("http") -> url
        else -> baseUrl + url
    }

    fun streamUrl(t: Track): String = abs(t.streamUrl) + "?t=" + URLEncoder.encode(token ?: "", "UTF-8")

    suspend fun request(method: String, path: String, body: Any? = null): Any? = withContext(Dispatchers.IO) {
        val conn = URL("$baseUrl/api$path").openConnection() as HttpURLConnection
        try {
            // HttpURLConnection has no PATCH; the server honours this override header.
            if (method == "PATCH") {
                conn.requestMethod = "POST"
                conn.setRequestProperty("X-HTTP-Method-Override", "PATCH")
            } else conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = 30_000
            token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            readResponse(conn, path)
        } finally {
            conn.disconnect()
        }
    }

    private fun readResponse(conn: HttpURLConnection, path: String): Any? {
        val code = conn.responseCode
        val text = (if (code >= 400) conn.errorStream else conn.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code == 401 && !path.startsWith("/auth/")) onUnauthorized()
        if (code >= 400) {
            val msg = runCatching { JSONObject(text).getString("error") }.getOrDefault("Request failed ($code)")
            throw ApiException(code, msg)
        }
        return if (text.isBlank()) null else JSONTokener(text).nextValue()
    }

    suspend fun obj(method: String, path: String, body: Any? = null) = request(method, path, body) as JSONObject
    suspend fun arr(path: String) = request("GET", path) as JSONArray

    // ---------- auth ----------
    suspend fun auth(register: Boolean, username: String, password: String) {
        val r = obj("POST", if (register) "/auth/register" else "/auth/login",
            JSONObject().put("username", username).put("password", password))
        token = r.getString("token")
        val u = r.getJSONObject("user")
        userId = u.getString("id")
        this.username = u.getString("username")
    }

    fun logout() {
        prefs.edit().remove("token").remove("userId").remove("username").apply()
    }

    // ---------- library ----------
    suspend fun home() = obj("GET", "/home")
    suspend fun tracks(sort: String = "recent") = arr("/tracks?sort=$sort").mapObjects(Track::from)
    suspend fun likes() = arr("/me/likes").mapObjects(Track::from)
    suspend fun playlists() = arr("/playlists").mapObjects(Playlist::from)
    suspend fun playlist(id: String) = Playlist.from(obj("GET", "/playlists/$id"))
    suspend fun createPlaylist(name: String) = Playlist.from(obj("POST", "/playlists", JSONObject().put("name", name)))
    suspend fun renamePlaylist(id: String, name: String) = Playlist.from(obj("PATCH", "/playlists/$id", JSONObject().put("name", name)))
    suspend fun deletePlaylist(id: String) { request("DELETE", "/playlists/$id") }
    suspend fun addToPlaylist(id: String, trackId: String) { request("POST", "/playlists/$id/tracks", JSONObject().put("trackId", trackId)) }
    suspend fun removeFromPlaylist(id: String, index: Int) = Playlist.from(obj("DELETE", "/playlists/$id/tracks/$index"))
    suspend fun reorderPlaylist(id: String, ids: List<String>) =
        Playlist.from(obj("PUT", "/playlists/$id/tracks", JSONObject().put("trackIds", JSONArray(ids))))

    suspend fun setLiked(id: String, liked: Boolean) { request(if (liked) "PUT" else "DELETE", "/tracks/$id/like") }
    suspend fun played(trackId: String) { runCatching { request("POST", "/me/played", JSONObject().put("trackId", trackId)) } }

    suspend fun search(q: String) = obj("GET", "/search?q=" + URLEncoder.encode(q, "UTF-8"))

    /** Saves an online result as a proxied track (idempotent server-side). */
    suspend fun ensureTrack(t: Track): Track = if (t.remote == null) t else Track.from(obj("POST", "/tracks/remote", t.remote))

    suspend fun uploaders() = arr("/users").mapObjects(Uploader::from)
    suspend fun userUploads(username: String) =
        obj("GET", "/users/" + URLEncoder.encode(username, "UTF-8")).getJSONArray("uploads").mapObjects(Track::from)

    // ---------- social ----------
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    suspend fun profile(username: String) = Profile.from(obj("GET", "/users/" + enc(username)))
    suspend fun setFollowing(username: String, follow: Boolean): JSONObject =
        obj(if (follow) "POST" else "DELETE", "/users/" + enc(username) + "/follow")
    suspend fun followers(username: String) = arr("/users/" + enc(username) + "/followers").mapObjects(Person::from)
    suspend fun following(username: String) = arr("/users/" + enc(username) + "/following").mapObjects(Person::from)
    suspend fun setBio(bio: String) = Person.from(obj("PATCH", "/me", JSONObject().put("bio", bio)))

    suspend fun conversations() = arr("/dms").mapObjects(Conversation::from)
    suspend fun unreadCount() = obj("GET", "/dms/unread").optInt("count")
    /** Loads the thread and marks incoming messages as read. */
    suspend fun thread(username: String): Pair<Person, List<Message>> {
        val r = obj("GET", "/dms/" + enc(username))
        return Person.from(r.getJSONObject("user")) to r.getJSONArray("messages").mapObjects(Message::from)
    }
    suspend fun sendDm(username: String, text: String) =
        Message.from(obj("POST", "/dms/" + enc(username), JSONObject().put("text", text)))

    /** Uploads a profile picture (multipart field "image"). */
    suspend fun uploadAvatar(context: Context, uri: Uri): Person = withContext(Dispatchers.IO) {
        val boundary = "----cadence" + UUID.randomUUID().toString().replace("-", "")
        val cr = context.contentResolver
        val mime = cr.getType(uri) ?: "image/jpeg"
        val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: throw ApiException(400, "Could not read the image")
        val conn = URL("$baseUrl/api/me/avatar").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            conn.outputStream.use { out ->
                out.write("--$boundary\r\nContent-Disposition: form-data; name=\"image\"; filename=\"avatar\"\r\nContent-Type: $mime\r\n\r\n".toByteArray())
                out.write(bytes)
                out.write("\r\n--$boundary--\r\n".toByteArray())
            }
            Person.from(readResponse(conn, "/me/avatar") as JSONObject)
        } finally {
            conn.disconnect()
        }
    }

    suspend fun downloads() = arr("/downloads").mapObjects(DownloadJob::from)
    suspend fun download(url: String) { request("POST", "/downloads", JSONObject().put("url", url)) }

    /** Multipart upload of audio files picked from the device. Returns a summary message. */
    suspend fun upload(context: Context, uris: List<Uri>, onProgress: (Float) -> Unit): String = withContext(Dispatchers.IO) {
        val boundary = "----cadence" + UUID.randomUUID().toString().replace("-", "")
        val cr = context.contentResolver
        val parts = uris.map { uri ->
            var name = "audio"
            var size = -1L
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    name = c.getString(0) ?: name
                    size = if (c.isNull(1)) -1 else c.getLong(1)
                }
            }
            Triple(uri, name.replace("\"", "'").replace("\r", "").replace("\n", ""), size)
        }
        val total = parts.sumOf { it.third.coerceAtLeast(0) }.coerceAtLeast(1)
        val conn = URL("$baseUrl/api/tracks").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setChunkedStreamingMode(64 * 1024)
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            var sent = 0L
            conn.outputStream.use { out ->
                for ((uri, name, _) in parts) {
                    val mime = cr.getType(uri) ?: "application/octet-stream"
                    out.write("--$boundary\r\nContent-Disposition: form-data; name=\"files\"; filename=\"$name\"\r\nContent-Type: $mime\r\n\r\n".toByteArray())
                    cr.openInputStream(uri)?.use { input ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            sent += n
                            onProgress((sent.toFloat() / total).coerceAtMost(1f))
                        }
                    }
                    out.write("\r\n".toByteArray())
                }
                out.write("--$boundary--\r\n".toByteArray())
            }
            val code = conn.responseCode
            val text = (if (code >= 400) conn.errorStream else conn.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val r = runCatching { JSONObject(text) }.getOrNull()
            val ok = r?.optJSONArray("tracks")?.length() ?: 0
            val errors = r?.optJSONArray("errors")?.mapObjects { "${it.optString("file")}: ${it.optString("error")}" } ?: emptyList()
            val dups = r?.optJSONArray("duplicates")?.length() ?: 0
            if (ok == 0 && errors.isEmpty()) throw ApiException(code, r?.optString("error") ?: "Upload failed ($code)")
            buildString {
                if (ok - dups > 0) append("Added ${ok - dups} song(s).")
                if (dups > 0) append(if (isEmpty()) "" else "\n").append("$dups already in the library.")
                errors.forEach { append("\n").append(it) }
            }
        } finally {
            conn.disconnect()
        }
    }
}
