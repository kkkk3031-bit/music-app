package com.khaled.cadence.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.khaled.cadence.Api
import com.khaled.cadence.DownloadJob
import com.khaled.cadence.Playback
import com.khaled.cadence.Playlist
import com.khaled.cadence.RoomClient
import com.khaled.cadence.Route
import com.khaled.cadence.Track
import com.khaled.cadence.mapObjects
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

// ---------------------------------------------------------------- login
@Composable
fun LoginScreen(onDone: () -> Unit) {
    var register by remember { mutableStateOf(false) }
    var server by remember { mutableStateOf(Api.baseUrl) }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Centered when it fits, scrollable when the keyboard leaves too little room.
    Box(Modifier.fillMaxSize().background(Bg).imePadding(), contentAlignment = Alignment.Center) {
    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(64.dp).clip(RoundedCornerShape(16.dp)).background(AccentGradient), contentAlignment = Alignment.Center) {
            Icon(com.khaled.cadence.R.drawable.ic_logo_bars.let { androidx.compose.ui.res.painterResource(it) }, null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(40.dp))
        }
        Text("Cadence", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 12.dp))
        Text(if (register) "Create an account to start listening." else "Welcome back. Your music is waiting.", color = Muted, modifier = Modifier.padding(bottom = 24.dp))
        OutlinedTextField(server, { server = it }, label = { Text("Server") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
        OutlinedTextField(user, { user = it }, label = { Text("Username") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        OutlinedTextField(pass, { pass = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Button(
            enabled = !busy && user.isNotBlank() && pass.isNotBlank(),
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        Api.baseUrl = server
                        Api.auth(register, user.trim(), pass)
                        onDone()
                    } catch (e: Exception) {
                        error = e.message ?: "Could not reach the server"
                    }
                    busy = false
                }
            },
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp).height(50.dp),
        ) { Text(if (register) "Create account" else "Log in", fontWeight = FontWeight.Bold) }
        TextButton(onClick = { register = !register }) { Text(if (register) "Have an account? Log in" else "New here? Create an account") }
    }
    }
}

// ---------------------------------------------------------------- home
@Composable
fun HomeScreen(open: (Route) -> Unit) {
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { Api.home() }.onSuccess { data = it }.onFailure { error = it.message } }
    val d = data
    LazyColumn(contentPadding = PaddingValues(16.dp)) {
        item {
            val hr = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
            val greet = when { hr < 5 -> "Good night"; hr < 12 -> "Good morning"; hr < 18 -> "Good afternoon"; else -> "Good evening" }
            Text("$greet, ${Api.username}", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 12.dp))
        }
        if (d == null) {
            item { Empty(error ?: "Loading…") }
            return@LazyColumn
        }
        val recent = d.getJSONArray("recentlyPlayed").mapObjects(Track::from)
        val uploads = d.getJSONArray("newUploads").mapObjects(Track::from)
        val playlists = d.getJSONArray("playlists").mapObjects(Playlist::from)
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                QuickTile("Liked Songs", null, Modifier.weight(1f), liked = true) { open(Route.Liked) }
                playlists.firstOrNull()?.let { p -> QuickTile(p.name, p.cover, Modifier.weight(1f)) { open(Route.PlaylistDetail(p.id)) } }
                    ?: Spacer(Modifier.weight(1f))
            }
        }
        if (recent.isNotEmpty()) {
            item { SectionTitle("Recently played") }
            item { CardRow(recent) { i -> Playback.playList(recent, i) } }
        }
        if (playlists.isNotEmpty()) {
            item { SectionTitle("Your playlists") }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(playlists) { p -> MediaCard(p.name, "${p.trackCount} songs", p.cover) { open(Route.PlaylistDetail(p.id)) } }
                }
            }
        }
        if (uploads.isNotEmpty()) {
            item { SectionTitle("New uploads") }
            item { CardRow(uploads) { i -> Playback.playList(uploads, i) } }
        }
        if (recent.isEmpty() && uploads.isEmpty()) {
            item { Empty("Your library is empty. Search for free music or import songs to get started.") }
        }
    }
}

@Composable
private fun QuickTile(title: String, cover: String?, modifier: Modifier, liked: Boolean = false, onClick: () -> Unit) {
    Row(
        modifier.clip(RoundedCornerShape(8.dp)).background(Bg3).clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (liked) Box(Modifier.size(56.dp).background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(androidx.compose.ui.graphics.Color(0xFF5B3DF5), androidx.compose.ui.graphics.Color(0xFFC7B5FF)))), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Favorite, null, tint = androidx.compose.ui.graphics.Color.White)
        } else Cover(cover, 56.dp, RoundedCornerShape(0.dp))
        Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 10.dp))
    }
}

@Composable
private fun CardRow(tracks: List<Track>, onPlay: (Int) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        itemsIndexed(tracks) { i, t -> MediaCard(t.title, t.artist, t.cover) { onPlay(i) } }
    }
}

@Composable
private fun MediaCard(title: String, sub: String, cover: String?, onClick: () -> Unit) {
    Column(Modifier.width(140.dp).clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(4.dp)) {
        Cover(cover, 132.dp, RoundedCornerShape(8.dp))
        Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
        Text(sub, color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ---------------------------------------------------------------- search
@Composable
fun SearchScreen(open: (Route) -> Unit) {
    var q by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(false) }
    LaunchedEffect(q) {
        if (q.isBlank()) { result = null; return@LaunchedEffect }
        delay(450)
        loading = true
        result = runCatching { Api.search(q.trim()) }.getOrElse { JSONObject().put("error", it.message) }
        loading = false
    }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            q, { q = it }, placeholder = { Text("What do you want to listen to?") }, singleLine = true,
            leadingIcon = { Icon(Icons.Default.Search, null) },
            shape = RoundedCornerShape(50),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        )
        val r = result
        LazyColumn(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
            if (loading) item { Empty("Searching…") }
            if (r == null) {
                item { Empty("Search your server's library and free online catalogues (Internet Archive, Jamendo).") }
                return@LazyColumn
            }
            r.optString("error").takeIf { it.isNotEmpty() }?.let { item { Empty(it) } }
            val local = r.optJSONArray("local")?.mapObjects(Track::from) ?: emptyList()
            val playlists = r.optJSONArray("playlists")?.mapObjects(Playlist::from) ?: emptyList()
            val archive = r.optJSONArray("archive")?.mapObjects(Track::remote) ?: emptyList()
            val jamendo = r.optJSONArray("jamendo")?.mapObjects(Track::remote) ?: emptyList()
            if (!loading && local.isEmpty() && archive.isEmpty() && jamendo.isEmpty() && playlists.isEmpty()) item { Empty("No results.") }
            if (local.isNotEmpty()) {
                item { SectionTitle("In your library") }
                itemsIndexed(local) { i, t -> TrackRow(t, { Playback.playList(local, i) }) }
            }
            if (playlists.isNotEmpty()) {
                item { SectionTitle("Playlists") }
                items(playlists) { p ->
                    Row(Modifier.fillMaxWidth().clickable { open(Route.PlaylistDetail(p.id)) }.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Cover(p.cover, 48.dp)
                        Text(p.name, Modifier.padding(start = 12.dp), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            if (archive.isNotEmpty()) {
                item { SectionTitle("Internet Archive") }
                itemsIndexed(archive) { i, t -> TrackRow(t, { Playback.playList(listOf(archive[i]), 0) }) }
            }
            if (jamendo.isNotEmpty()) {
                item { SectionTitle("Jamendo") }
                itemsIndexed(jamendo) { i, t -> TrackRow(t, { Playback.playList(listOf(jamendo[i]), 0) }) }
            }
        }
    }
}

// ---------------------------------------------------------------- library
@Composable
fun LibraryScreen(open: (Route) -> Unit) {
    var tab by remember { mutableStateOf(0) }
    var playlists by remember { mutableStateOf<List<Playlist>?>(null) }
    var songs by remember { mutableStateOf<List<Track>?>(null) }
    var creating by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(tab, reload) {
        if (tab == 0) playlists = runCatching { Api.playlists() }.getOrDefault(emptyList())
        else songs = runCatching { Api.tracks() }.getOrDefault(emptyList())
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Your Library", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
            IconButton(onClick = { creating = true }) { Icon(Icons.Default.Add, "New playlist") }
        }
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(tab == 0, { tab = 0 }, { Text("Playlists") })
            FilterChip(tab == 1, { tab = 1 }, { Text("Songs") })
        }
        LazyColumn(contentPadding = PaddingValues(12.dp)) {
            if (tab == 0) {
                item {
                    Row(Modifier.fillMaxWidth().clickable { open(Route.Liked) }.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(56.dp).clip(RoundedCornerShape(6.dp)).background(androidx.compose.ui.graphics.Color(0xFF5B3DF5)), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Favorite, null, tint = androidx.compose.ui.graphics.Color.White)
                        }
                        Column(Modifier.padding(start = 12.dp)) { Text("Liked Songs", fontWeight = FontWeight.SemiBold); Text("Playlist", color = Muted, fontSize = 13.sp) }
                    }
                }
                val list = playlists
                if (list == null) item { Empty("Loading…") }
                else items(list) { p ->
                    Row(Modifier.fillMaxWidth().clickable { open(Route.PlaylistDetail(p.id)) }.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Cover(p.cover, 56.dp)
                        Column(Modifier.padding(start = 12.dp)) {
                            Text(p.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("Playlist · ${p.trackCount} songs", color = Muted, fontSize = 13.sp)
                        }
                    }
                }
            } else {
                val list = songs
                if (list == null) item { Empty("Loading…") }
                else if (list.isEmpty()) item { Empty("No songs yet. Use Import to upload or download music.") }
                else {
                    item { PlayShuffleBar(list) }
                    itemsIndexed(list) { i, t -> TrackRow(t, { Playback.playList(list, i) }) }
                }
            }
        }
    }
    if (creating) TextPromptDialog("New playlist", confirm = "Create", onDismiss = { creating = false }) { name ->
        creating = false
        scope.launch {
            runCatching { Api.createPlaylist(name) }.onSuccess { open(Route.PlaylistDetail(it.id)) }.onFailure { Playback.message.value = it.message }
            reload++
        }
    }
}

@Composable
private fun PlayShuffleBar(tracks: List<Track>) {
    Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(52.dp).clip(CircleShape).background(AccentGradient).clickable(enabled = tracks.isNotEmpty()) { Playback.playList(tracks, 0) },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Default.PlayArrow, "Play", tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(30.dp)) }
        IconButton(onClick = {
            if (tracks.isNotEmpty()) {
                Playback.playList(tracks, tracks.indices.random())
                if (!Playback.shuffle.value) Playback.toggleShuffle()
            }
        }) { Icon(Icons.Default.Shuffle, "Shuffle play", tint = Muted) }
        Text("${tracks.size} songs", color = Muted)
    }
}

// ---------------------------------------------------------------- playlist / liked
@Composable
fun PlaylistScreen(id: String, back: () -> Unit) {
    var p by remember { mutableStateOf<Playlist?>(null) }
    var renaming by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(id) { p = runCatching { Api.playlist(id) }.getOrNull() }
    val pl = p
    fun update(block: suspend () -> Playlist) = scope.launch {
        runCatching { block() }.onSuccess { p = it }.onFailure { Playback.message.value = it.message }
    }
    LazyColumn(contentPadding = PaddingValues(12.dp)) {
        item { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }
        if (pl == null) { item { Empty("Loading…") }; return@LazyColumn }
        val mine = pl.ownerId == Api.userId
        item {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Cover(pl.cover, 200.dp, RoundedCornerShape(8.dp))
                Text(pl.name, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 14.dp).clickable(enabled = mine) { renaming = true })
                Text("${pl.ownerName} · ${pl.trackCount} songs", color = Muted)
            }
            PlayShuffleBar(pl.tracks)
            if (mine) Row {
                TextButton(onClick = { renaming = true }) { Text("Rename") }
                TextButton(onClick = { scope.launch { runCatching { Api.deletePlaylist(pl.id) }; back() } }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            }
        }
        if (pl.tracks.isEmpty()) item { Empty("This playlist is empty. Add songs from Search or your Library with ⋮ → Add to playlist.") }
        itemsIndexed(pl.tracks) { i, t ->
            TrackRow(t, { Playback.playList(pl.tracks, i) }, extraMenu = if (!mine) null else { close ->
                val ids = pl.tracks.map { it.id }
                if (i > 0) DropdownMenuItem(text = { Text("Move up") }, onClick = {
                    close(); update { Api.reorderPlaylist(pl.id, ids.toMutableList().apply { add(i - 1, removeAt(i)) }) }
                })
                if (i < ids.size - 1) DropdownMenuItem(text = { Text("Move down") }, onClick = {
                    close(); update { Api.reorderPlaylist(pl.id, ids.toMutableList().apply { add(i + 1, removeAt(i)) }) }
                })
                DropdownMenuItem(text = { Text("Remove from playlist") }, onClick = { close(); update { Api.removeFromPlaylist(pl.id, i) } })
            })
        }
    }
    if (renaming && pl != null) TextPromptDialog("Rename playlist", pl.name, onDismiss = { renaming = false }) { name ->
        renaming = false
        update { Api.renamePlaylist(pl.id, name) }
    }
}

@Composable
fun LikedScreen(back: () -> Unit) {
    var tracks by remember { mutableStateOf<List<Track>?>(null) }
    LaunchedEffect(Unit) { tracks = runCatching { Api.likes() }.getOrDefault(emptyList()) }
    LazyColumn(contentPadding = PaddingValues(12.dp)) {
        item { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }
        item { Text("Liked Songs", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(4.dp)) }
        val list = tracks
        if (list == null) item { Empty("Loading…") }
        else if (list.isEmpty()) item { Empty("Songs you like will appear here.") }
        else {
            item { PlayShuffleBar(list) }
            itemsIndexed(list) { i, t -> TrackRow(t, { Playback.playList(list, i) }) }
        }
    }
}

// ---------------------------------------------------------------- import
@Composable
fun ImportScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var jobs by remember { mutableStateOf<List<DownloadJob>>(emptyList()) }
    var uploadProgress by remember { mutableStateOf<Float?>(null) }
    var uploadResult by remember { mutableStateOf<String?>(null) }
    val update by RoomClient.downloads.collectAsState()

    LaunchedEffect(Unit) { jobs = runCatching { Api.downloads() }.getOrDefault(emptyList()) }
    LaunchedEffect(update) {
        val j = update?.let(DownloadJob::from) ?: return@LaunchedEffect
        jobs = listOf(j) + jobs.filter { it.id != j.id }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        uploadProgress = 0f
        uploadResult = null
        scope.launch {
            uploadResult = runCatching { Api.upload(context, uris) { p -> uploadProgress = p } }.getOrElse { it.message }
            uploadProgress = null
        }
    }

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("Import music", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold) }
        item { SectionTitle("Upload from this phone") }
        item {
            Button(onClick = { picker.launch("audio/*") }, enabled = uploadProgress == null) { Text("Choose audio files") }
            uploadProgress?.let { LinearProgressIndicator(progress = { it }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) }
            uploadResult?.let { Text(it, color = Muted, modifier = Modifier.padding(top = 8.dp)) }
        }
        item { SectionTitle("Download from a link") }
        item {
            Text("archive.org item, Jamendo track link or a direct audio file link.", color = Muted, fontSize = 13.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(url, { url = it }, placeholder = { Text("https://…") }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go))
                Button(onClick = {
                    val u = url.trim()
                    scope.launch {
                        runCatching { Api.download(u) }
                            .onSuccess { url = ""; jobs = Api.downloads(); Playback.message.value = "Download queued" }
                            .onFailure { Playback.message.value = it.message }
                    }
                }, enabled = url.isNotBlank(), modifier = Modifier.padding(start = 8.dp)) { Text("Get") }
            }
        }
        items(jobs, key = { it.id }) { j ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Bg3).padding(12.dp)) {
                Row {
                    Text(j.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                    Text(j.status, color = when (j.status) { "done" -> androidx.compose.ui.graphics.Color(0xFF4FD18B); "error" -> MaterialTheme.colorScheme.error; else -> Muted }, fontSize = 12.sp)
                }
                if (j.status != "error") LinearProgressIndicator(progress = { if (j.status == "done") 1f else j.progress.toFloat() }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                j.error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            }
        }
    }
}

// ---------------------------------------------------------------- rooms
@Composable
fun RoomsScreen() {
    val room by RoomClient.room.collectAsState()
    val r = room
    if (r == null) RoomLobby() else RoomDetail(r)
}

@Composable
private fun RoomLobby() {
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Listen together", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Text("Start a room and share the code. Everyone hears the same song at the same moment. The host controls playback, anyone can queue songs and chat.", color = Muted)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(name, { name = it }, label = { Text("Room name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(onClick = { scope.launch { runCatching { RoomClient.create(name.ifBlank { "${Api.username}'s room" }) }.onFailure { Playback.message.value = it.message } } },
            modifier = Modifier.fillMaxWidth()) { Text("Create room") }
        Spacer(Modifier.height(16.dp))
        val join = { scope.launch { runCatching { RoomClient.join(code) }.onFailure { Playback.message.value = it.message } }; Unit }
        OutlinedTextField(code, { code = it.uppercase().take(6) }, label = { Text("Room code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { if (code.length == 6) join() }))
        OutlinedButton(onClick = join, enabled = code.length == 6, modifier = Modifier.fillMaxWidth()) { Text("Join") }
    }
}

@Composable
private fun RoomDetail(r: JSONObject) {
    val scope = rememberCoroutineScope()
    val chat by RoomClient.chat.collectAsState()
    var msg by remember { mutableStateOf("") }
    var q by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Track>>(emptyList()) }
    val listState = rememberLazyListState()
    LaunchedEffect(q) {
        if (q.isBlank()) { results = emptyList(); return@LaunchedEffect }
        delay(450)
        results = runCatching {
            val s = Api.search(q.trim())
            s.getJSONArray("local").mapObjects(Track::from) + s.getJSONArray("archive").mapObjects(Track::remote)
        }.getOrDefault(emptyList()).take(10)
    }
    val pb = r.getJSONObject("playback")
    val track = pb.optJSONObject("track")?.let(Track::from)
    val host = RoomClient.isHost
    val members = r.getJSONArray("members").mapObjects { it }
    val queue = r.getJSONArray("queue").mapObjects { it }

    LazyColumn(state = listState, contentPadding = PaddingValues(16.dp), modifier = Modifier.imePadding()) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("LISTENING ROOM", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Text(r.optString("name"), fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(r.optString("code"), fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 4.sp,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Bg3).padding(horizontal = 10.dp, vertical = 4.dp))
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 16.dp).clip(RoundedCornerShape(12.dp)).background(Bg3).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(track?.cover, 84.dp, RoundedCornerShape(8.dp))
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                    Text(if (track == null) "Nothing playing" else if (pb.optBoolean("playing")) "NOW PLAYING" else "PAUSED", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Text(track?.title ?: if (host) "Search below and tap a song" else "Waiting for the host", fontWeight = FontWeight.Bold, fontSize = 18.sp, maxLines = 2)
                    track?.let { Text(it.artist, color = Muted) }
                    if (host && track != null) Row {
                        TextButton(onClick = { Playback.toggle() }) { Text(if (pb.optBoolean("playing")) "Pause" else "Play") }
                        TextButton(onClick = { Playback.next() }) { Text("Skip") }
                    }
                }
            }
            Text("Listeners", fontWeight = FontWeight.Bold)
            Text(members.joinToString { it.optString("username") + if (it.optString("id") == r.optString("hostId")) " (host)" else "" }, color = Muted, modifier = Modifier.padding(bottom = 8.dp))
            TextButton(onClick = { scope.launch { RoomClient.leave() } }) { Text("Leave room", color = MaterialTheme.colorScheme.error) }
        }
        item { SectionTitle("Up next" + if (queue.isNotEmpty()) " · ${queue.size}" else "") }
        if (queue.isEmpty()) item { Text("Queue is empty.", color = Muted) }
        items(queue) { qi ->
            val t = qi.optJSONObject("track")
            Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(t?.optString("cover"), 40.dp)
                Column(Modifier.padding(start = 10.dp)) {
                    Text(t?.optString("title") ?: "Unavailable", fontWeight = FontWeight.SemiBold)
                    Text("added by ${qi.optString("addedBy")}", color = Muted, fontSize = 12.sp)
                }
            }
        }
        item {
            SectionTitle(if (host) "Play or queue a song" else "Add songs to the queue")
            OutlinedTextField(q, { q = it }, placeholder = { Text("Search songs…") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        items(results, key = { it.id }) { t -> TrackRow(t, { Playback.playList(listOf(t), 0) }) }
        item { SectionTitle("Chat") }
        items(chat) { m ->
            Column(Modifier.padding(vertical = 4.dp)) {
                Text(m.optString("username"), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text(m.optString("text"))
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                OutlinedTextField(msg, { msg = it }, placeholder = { Text("Say something…") }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        val text = msg.trim()
                        if (text.isNotEmpty()) { msg = ""; scope.launch { RoomClient.sendChat(text) } }
                    }))
                IconButton(onClick = {
                    val text = msg.trim()
                    if (text.isNotEmpty()) { msg = ""; scope.launch { RoomClient.sendChat(text) } }
                }) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = Accent) }
            }
        }
    }
}

@Composable
fun ProfileScreen(onLogout: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp)) {
        Box(Modifier.size(88.dp).clip(CircleShape).background(AccentGradient), contentAlignment = Alignment.Center) {
            Text((Api.username ?: "?").take(1).uppercase(), fontSize = 36.sp, fontWeight = FontWeight.ExtraBold, color = androidx.compose.ui.graphics.Color.White)
        }
        Text(Api.username ?: "", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 12.dp))
        Text(Api.baseUrl, color = Muted)
        Spacer(Modifier.height(24.dp))
        OutlinedButton(onClick = onLogout, colors = ButtonDefaults.outlinedButtonColors()) { Text("Log out") }
        Spacer(Modifier.aspectRatio(1f))
    }
}
