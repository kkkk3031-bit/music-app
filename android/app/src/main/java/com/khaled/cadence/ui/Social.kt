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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.khaled.cadence.Api
import com.khaled.cadence.Conversation
import com.khaled.cadence.Message
import com.khaled.cadence.Person
import com.khaled.cadence.Playback
import com.khaled.cadence.Profile
import com.khaled.cadence.RoomClient
import com.khaled.cadence.Route
import com.khaled.cadence.Track
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/** Round profile picture; falls back to the first letter of the name. */
@Composable
fun Avatar(person: Person?, size: Dp, name: String? = person?.username) {
    val url = Api.abs(person?.avatar)
    if (url != null) Cover(person?.avatar, size, CircleShape)
    else Box(Modifier.size(size).clip(CircleShape).background(AccentGradient), contentAlignment = Alignment.Center) {
        Text((name ?: "?").take(1).uppercase(), fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
    }
}

@Composable
private fun BackRow(back: () -> Unit, title: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        title?.let { Text(it, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}

// ---------------------------------------------------------------- profile
/**
 * Instagram-style profile: avatar, counts, bio, follow/message, and a grid of the person's songs.
 * When it is your own profile it offers editing (photo + bio) and log out instead.
 */
@Composable
fun UserProfileScreen(username: String, open: (Route) -> Unit, back: (() -> Unit)?, onLogout: (() -> Unit)? = null) {
    val me = username.equals(Api.username, ignoreCase = true)
    var profile by remember { mutableStateOf<Profile?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    var tab by remember { mutableStateOf(0) }
    var editing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(username, reload) {
        runCatching { Api.profile(username) }.onSuccess { profile = it; error = null }.onFailure { error = it.message }
    }
    val pickAvatar = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching { Api.uploadAvatar(context, uri) }
                .onSuccess { reload++; Playback.message.value = "Profile photo updated" }
                .onFailure { Playback.message.value = it.message }
        }
    }

    val p = profile
    LazyColumn(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
        item { if (back != null) BackRow(back) }
        if (p == null) { item { Empty(error ?: "Loading…") }; return@LazyColumn }
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.clickable(enabled = me) { pickAvatar.launch("image/*") }) { Avatar(p.user, 86.dp) }
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.SpaceEvenly) {
                    Stat(p.uploads.size, "songs") {}
                    Stat(p.followers, "followers") { open(Route.People(p.user.username, followers = true)) }
                    Stat(p.following, "following") { open(Route.People(p.user.username, followers = false)) }
                }
            }
            Text(p.user.username, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(horizontal = 4.dp))
            if (p.followsYou && !me) Box(Modifier.padding(start = 4.dp, top = 4.dp)) { Pill("Follows you") }
            if (p.user.bio.isNotBlank()) Text(p.user.bio, modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp))
            else if (me) Text("Add a bio so people know what you're into.", color = Muted, modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp))

            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (me) {
                    OutlinedButton(onClick = { editing = true }, modifier = Modifier.weight(1f)) { Text("Edit profile") }
                    onLogout?.let { OutlinedButton(onClick = it, modifier = Modifier.weight(1f)) { Text("Log out") } }
                } else {
                    val following = p.isFollowing
                    val colors = if (following) ButtonDefaults.buttonColors(containerColor = Bg4, contentColor = Color.White) else ButtonDefaults.buttonColors()
                    Button(
                        enabled = !busy, colors = colors, modifier = Modifier.weight(1f),
                        onClick = {
                            busy = true
                            scope.launch {
                                runCatching { Api.setFollowing(p.user.username, !following) }
                                    .onSuccess { r -> profile = p.copy(isFollowing = r.optBoolean("isFollowing"), followers = r.optInt("followers")) }
                                    .onFailure { Playback.message.value = it.message }
                                busy = false
                            }
                        },
                    ) { Text(if (following) "Following" else if (p.followsYou) "Follow back" else "Follow", fontWeight = FontWeight.Bold) }
                    OutlinedButton(onClick = { open(Route.Chat(p.user.username)) }, modifier = Modifier.weight(1f)) { Text("Message") }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                FilterChip(tab == 0, { tab = 0 }, { Text("Songs · ${p.uploads.size}") })
                FilterChip(tab == 1, { tab = 1 }, { Text("Playlists · ${p.playlists.size}") })
            }
        }
        if (tab == 0) {
            if (p.uploads.isEmpty()) item { Empty(if (me) "Songs you upload show up here. Use Import to add some." else "${p.user.username} hasn't uploaded any music yet.") }
            else items(p.uploads.chunked(3)) { row -> SongGridRow(row, p.uploads) }
        } else {
            if (p.playlists.isEmpty()) item { Empty("No playlists yet.") }
            else items(p.playlists) { pl ->
                Row(Modifier.fillMaxWidth().clickable { open(Route.PlaylistDetail(pl.id)) }.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Cover(pl.cover, 56.dp)
                    Column(Modifier.padding(start = 12.dp)) {
                        Text(pl.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("Playlist · ${pl.trackCount} songs", color = Muted, fontSize = 13.sp)
                    }
                }
            }
        }
    }

    if (editing && p != null) EditProfileDialog(
        p.user,
        onPhoto = { pickAvatar.launch("image/*") },
        onDismiss = { editing = false },
    ) { bio ->
        editing = false
        scope.launch {
            runCatching { Api.setBio(bio) }
                .onSuccess { profile = p.copy(user = it); Playback.message.value = "Profile saved" }
                .onFailure { Playback.message.value = it.message }
        }
    }
}

@Composable
private fun Stat(n: Int, label: String, onClick: () -> Unit) {
    Column(Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("$n", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
        Text(label, color = Muted, fontSize = 12.sp)
    }
}

/** One row of the 3-column song grid; tapping a tile plays the whole grid from there. */
@Composable
private fun SongGridRow(row: List<Track>, all: List<Track>) {
    val current by Playback.current.collectAsState()
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        row.forEach { t ->
            Box(Modifier.weight(1f).aspectRatio(1f).clickable { Playback.playList(all, all.indexOf(t)) }) {
                androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) { Cover(t.cover, maxWidth, RoundedCornerShape(2.dp)) }
                Column(
                    Modifier.align(Alignment.BottomStart).fillMaxWidth()
                        .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000))))
                        .padding(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (current?.id == t.id) Icon(Icons.Default.PlayArrow, null, tint = Accent, modifier = Modifier.size(14.dp))
                        Text(t.title, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White)
                    }
                }
            }
        }
        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
    }
}

@Composable
private fun EditProfileDialog(user: Person, onPhoto: () -> Unit, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var bio by remember { mutableStateOf(user.bio) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit profile") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(user, 72.dp)
                TextButton(onClick = onPhoto) { Text("Change photo") }
                OutlinedTextField(
                    bio, { bio = it.take(150) }, label = { Text("Bio") }, minLines = 2, maxLines = 4,
                    supportingText = { Text("${bio.length}/150") }, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onSave(bio.trim()) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- followers / following
@Composable
fun PeopleScreen(username: String, followers: Boolean, open: (Route) -> Unit, back: () -> Unit) {
    var people by remember { mutableStateOf<List<Person>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(username, followers) {
        runCatching { if (followers) Api.followers(username) else Api.following(username) }
            .onSuccess { people = it }.onFailure { error = it.message }
    }
    LazyColumn(contentPadding = PaddingValues(12.dp)) {
        item { BackRow(back, if (followers) "$username's followers" else "$username follows") }
        val list = people
        if (list == null) item { Empty(error ?: "Loading…") }
        else if (list.isEmpty()) item { Empty(if (followers) "No followers yet." else "Not following anyone yet.") }
        else items(list, key = { it.id }) { PersonRow(it) { open(Route.UserProfile(it.username)) } }
    }
}

@Composable
fun PersonRow(p: Person, sub: String? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(p, 48.dp)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(p.username, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            (sub ?: p.bio.takeIf { it.isNotBlank() })?.let { Text(it, color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

// ---------------------------------------------------------------- inbox
@Composable
fun InboxScreen(open: (Route) -> Unit, back: () -> Unit) {
    var convos by remember { mutableStateOf<List<Conversation>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val tick by RoomClient.dmTick.collectAsState()
    LaunchedEffect(tick) {
        runCatching { Api.conversations() }.onSuccess { convos = it; error = null }.onFailure { error = it.message }
    }
    LazyColumn(contentPadding = PaddingValues(12.dp)) {
        item { BackRow(back, "Messages") }
        val list = convos
        if (list == null) item { Empty(error ?: "Loading…") }
        else if (list.isEmpty()) item { Empty("No messages yet. Open someone's profile and tap Message to start a chat.") }
        else items(list, key = { it.user.id }) { c ->
            val mine = c.last.from == Api.userId
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { open(Route.Chat(c.user.username)) }.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(c.user, 52.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(c.user.username, fontWeight = if (c.unread > 0) FontWeight.ExtraBold else FontWeight.SemiBold)
                    Text(
                        (if (mine) "You: " else "") + c.last.text + " · " + shortTime(c.last.createdAt),
                        color = if (c.unread > 0) Color.White else Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (c.unread > 0) Badge(c.unread)
            }
        }
    }
}

@Composable
fun Badge(n: Int) {
    Box(Modifier.size(20.dp).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
        Text(if (n > 9) "9+" else "$n", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.White)
    }
}

private fun shortTime(ms: Long): String {
    val d = Date(ms)
    val sameDay = DateFormat.getDateInstance(DateFormat.SHORT).let { it.format(d) == it.format(Date()) }
    return if (sameDay) DateFormat.getTimeInstance(DateFormat.SHORT).format(d) else DateFormat.getDateInstance(DateFormat.MEDIUM).format(d)
}

// ---------------------------------------------------------------- chat
@Composable
fun ChatScreen(username: String, open: (Route) -> Unit, back: () -> Unit) {
    var other by remember { mutableStateOf<Person?>(null) }
    var messages by remember { mutableStateOf<List<Message>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val live by RoomClient.dm.collectAsState()

    LaunchedEffect(username) {
        runCatching { Api.thread(username) }
            .onSuccess { (u, m) -> other = u; messages = m; RoomClient.dmTick.value++ }
            .onFailure { error = it.message }
    }
    // Live messages for this conversation arrive over the socket.
    LaunchedEffect(live) {
        val o = other ?: return@LaunchedEffect
        val m = live?.let(Message::from) ?: return@LaunchedEffect
        if ((m.from == o.id || m.to == o.id) && messages?.none { it.id == m.id } == true) {
            messages = messages!! + m
            // Opening the thread again marks the new incoming message as read.
            if (m.from == o.id) runCatching { Api.thread(username) }.onSuccess { RoomClient.dmTick.value++ }
        }
    }
    val count = messages?.size ?: 0
    LaunchedEffect(count) { if (count > 0) listState.animateScrollToItem(count - 1) }

    fun send() {
        val t = text.trim()
        if (t.isEmpty() || sending) return
        sending = true
        scope.launch {
            runCatching { Api.sendDm(username, t) }
                .onSuccess { m -> text = ""; if (messages?.none { it.id == m.id } == true) messages = messages!! + m }
                .onFailure { Playback.message.value = it.message }
            sending = false
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).clickable { open(Route.UserProfile(username)) }.padding(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(other, 36.dp, username)
                Text(username, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(start = 10.dp))
            }
        }
        val list = messages
        LazyColumn(state = listState, modifier = Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (list == null) item { Empty(error ?: "Loading…") }
            else if (list.isEmpty()) item { Empty("Say hi to $username 👋") }
            else itemsIndexed(list, key = { _, m -> m.id }) { i, m ->
                val mine = m.from == Api.userId
                val lastMine = mine && list.subList(i + 1, list.size).none { it.from == Api.userId }
                Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                    Text(
                        m.text,
                        modifier = Modifier.widthIn(max = 280.dp)
                            .clip(RoundedCornerShape(18.dp))
                            .background(if (mine) Accent else Bg4)
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        color = Color.White,
                    )
                    if (lastMine) Text(if (m.read) "Seen" else shortTime(m.createdAt), color = Muted, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                text, { text = it.take(2000) }, placeholder = { Text("Message…") }, maxLines = 4,
                shape = RoundedCornerShape(24.dp), modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
            )
            IconButton(onClick = { send() }, enabled = text.isNotBlank() && !sending) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = Accent) }
        }
    }
}
