package com.khaled.cadence.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import com.khaled.cadence.Api
import com.khaled.cadence.Playback
import com.khaled.cadence.Playlist
import com.khaled.cadence.Track
import com.khaled.cadence.formatTime
import kotlinx.coroutines.launch

@Composable
fun Cover(url: String?, size: Dp, shape: Shape = RoundedCornerShape(6.dp), modifier: Modifier = Modifier) {
    val full = Api.abs(url)
    Box(modifier.size(size).clip(shape).background(Bg4), contentAlignment = Alignment.Center) {
        if (full != null) {
            SubcomposeAsyncImage(
                model = full, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                error = { Icon(Icons.Default.MusicNote, null, tint = Muted, modifier = Modifier.size(size / 2.5f)) },
            )
        } else Icon(Icons.Default.MusicNote, null, tint = Muted, modifier = Modifier.size(size / 2.5f))
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) =
    Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = modifier.padding(top = 20.dp, bottom = 10.dp))

@Composable
fun Empty(text: String) = Text(text, color = Muted, modifier = Modifier.fillMaxWidth().padding(32.dp))

/** Holds "add to playlist" dialog state so any track row can open it. */
object Dialogs {
    var addTo by mutableStateOf<Track?>(null)
}

/** Lets deep components (track menus) navigate without threading `open` through every call. */
object Nav {
    var open: (com.khaled.cadence.Route) -> Unit = {}
}

@Composable
fun TrackRow(
    track: Track,
    onPlay: () -> Unit,
    extraMenu: (@Composable (close: () -> Unit) -> Unit)? = null,
) {
    val current by Playback.current.collectAsState()
    val playing = current?.id == track.id
    var menu by remember { mutableStateOf(false) }
    var liked by remember(track.id, track.liked) { mutableStateOf(track.liked) }
    val scope = rememberCoroutineScope()

    Row(
        Modifier.fillMaxWidth().clickable(onClick = onPlay).padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(track.cover, 48.dp)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (playing) Icon(Icons.Default.GraphicEq, null, tint = Accent, modifier = Modifier.size(16.dp).padding(end = 4.dp))
                Text(
                    track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold,
                    color = if (playing) Accent else MaterialTheme.colorScheme.onSurface,
                )
            }
            val sub = buildString {
                if (track.type == "remote" || track.source == "archive" || track.source == "jamendo") append(track.source.uppercase()).append(" · ")
                append(track.artist)
                if (track.duration > 0) append(" · ").append(formatTime(track.duration.toLong()))
            }
            Text(sub, color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = {
            scope.launch {
                try {
                    val t = Api.ensureTrack(track)
                    Api.setLiked(t.id, !liked)
                    liked = !liked
                    Playback.setLiked(t.id, liked)
                    Playback.message.value = if (liked) "Added to Liked Songs" else "Removed from Liked Songs"
                } catch (e: Exception) {
                    Playback.message.value = e.message
                }
            }
        }) {
            Icon(
                if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                contentDescription = if (liked) "Unlike" else "Like",
                tint = if (liked) Accent2 else Muted,
            )
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More", tint = Muted) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text(if (Playback.inRoom) "Add to room queue" else "Add to queue") }, onClick = {
                    menu = false
                    Playback.addToQueue(track)
                })
                DropdownMenuItem(text = { Text("Add to playlist…") }, onClick = {
                    menu = false
                    Dialogs.addTo = track
                })
                track.ownerName?.takeIf { track.ownerId != Api.userId }?.let { owner ->
                    DropdownMenuItem(text = { Text("View $owner's profile") }, onClick = {
                        menu = false
                        Nav.open(com.khaled.cadence.Route.UserProfile(owner))
                    })
                }
                if (track.remote != null) {
                    DropdownMenuItem(text = { Text("Download to library") }, onClick = {
                        menu = false
                        scope.launch {
                            val r = track.remote
                            val url = if (r.optString("source") == "jamendo") "https://www.jamendo.com/track/${r.optString("sourceId")}" else r.optString("url")
                            Playback.message.value = runCatching { Api.download(url); "Download started" }.getOrElse { it.message }
                        }
                    })
                }
                extraMenu?.let {
                    HorizontalDivider()
                    it { menu = false }
                }
            }
        }
    }
}

@Composable
fun AddToPlaylistDialog() {
    val track = Dialogs.addTo ?: return
    val scope = rememberCoroutineScope()
    var lists by remember { mutableStateOf<List<Playlist>?>(null) }
    var newName by remember { mutableStateOf("") }
    androidx.compose.runtime.LaunchedEffect(track) { lists = runCatching { Api.playlists() }.getOrDefault(emptyList()) }

    fun add(p: Playlist) = scope.launch {
        try {
            val t = Api.ensureTrack(track)
            Api.addToPlaylist(p.id, t.id)
            Playback.message.value = "Added to ${p.name}"
        } catch (e: Exception) {
            Playback.message.value = e.message
        }
        Dialogs.addTo = null
    }

    AlertDialog(
        onDismissRequest = { Dialogs.addTo = null },
        title = { Text("Add to playlist") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(newName, { newName = it }, label = { Text("New playlist") }, singleLine = true, modifier = Modifier.weight(1f))
                    TextButton(enabled = newName.isNotBlank(), onClick = {
                        scope.launch {
                            runCatching { Api.createPlaylist(newName.trim()) }.onSuccess { add(it) }.onFailure { Playback.message.value = it.message }
                        }
                    }) { Text("Create") }
                }
                lists?.forEach { p ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { add(p) }.padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Cover(p.cover, 40.dp)
                        Text(p.name, Modifier.padding(start = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { Dialogs.addTo = null }) { Text("Close") } },
    )
}

@Composable
fun TextPromptDialog(title: String, initial: String = "", confirm: String = "Save", onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(value, { value = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(enabled = value.isNotBlank(), onClick = { onConfirm(value.trim()) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun Pill(text: String) = Text(
    text, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Muted,
    modifier = Modifier.clip(RoundedCornerShape(50)).background(Bg4).padding(horizontal = 8.dp, vertical = 2.dp),
)

@Composable
fun Gap(w: Dp) = Box(Modifier.width(w))
