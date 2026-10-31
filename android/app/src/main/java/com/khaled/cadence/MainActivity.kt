package com.khaled.cadence

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.Player
import com.khaled.cadence.ui.AddToPlaylistDialog
import com.khaled.cadence.ui.Bg
import com.khaled.cadence.ui.Bg3
import com.khaled.cadence.ui.Bg4
import com.khaled.cadence.ui.CadenceTheme
import com.khaled.cadence.ui.Cover
import com.khaled.cadence.ui.HomeScreen
import com.khaled.cadence.ui.ImportScreen
import com.khaled.cadence.ui.LibraryScreen
import com.khaled.cadence.ui.LikedScreen
import com.khaled.cadence.ui.LoginScreen
import com.khaled.cadence.ui.Muted
import com.khaled.cadence.ui.Accent
import com.khaled.cadence.ui.PlaylistScreen
import com.khaled.cadence.ui.Badge
import com.khaled.cadence.ui.ChatScreen
import com.khaled.cadence.ui.InboxScreen
import com.khaled.cadence.ui.Nav
import com.khaled.cadence.ui.PeopleScreen
import com.khaled.cadence.ui.RoomsScreen
import com.khaled.cadence.ui.SearchScreen
import com.khaled.cadence.ui.UserProfileScreen

sealed interface Route {
    data object Home : Route
    data object Search : Route
    data object Library : Route
    data object Rooms : Route
    data object Import : Route
    data object Liked : Route
    data object Profile : Route
    data class PlaylistDetail(val id: String) : Route
    data class UserProfile(val username: String) : Route
    data class People(val username: String, val followers: Boolean) : Route
    data object Inbox : Route
    data class Chat(val username: String) : Route
}

private data class Tab(val route: Route, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab(Route.Home, "Home", Icons.Default.Home),
    Tab(Route.Search, "Search", Icons.Default.Search),
    Tab(Route.Library, "Library", Icons.Default.LibraryMusic),
    Tab(Route.Rooms, "Rooms", Icons.Default.Groups),
    Tab(Route.Import, "Import", Icons.Default.CloudDownload),
)

class MainActivity : ComponentActivity() {
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Api.init(applicationContext)
        if (Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)

        setContent {
            CadenceTheme {
                // Surface provides the default content (text/icon) colour for the whole app.
                Surface(color = Bg, contentColor = MaterialTheme.colorScheme.onBackground) {
                    var signedIn by remember { mutableStateOf(Api.signedIn) }
                    Api.onUnauthorized = { runOnUiThread { logout(); signedIn = false } }
                    if (!signedIn) LoginScreen { signedIn = true }
                    else App(onLogout = { logout(); signedIn = false })
                }
            }
        }
    }

    private fun logout() {
        RoomClient.disconnect()
        Playback.leaveRoom()
        Api.logout()
    }
}

@Composable
private fun App(onLogout: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(Unit) {
        Playback.connect(context.applicationContext)
        RoomClient.connect()
    }
    val stack = remember { mutableStateListOf<Route>(Route.Home) }
    var nowPlaying by remember { mutableStateOf(false) }
    var queueOpen by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val message by Playback.message.collectAsState()
    LaunchedEffect(message) {
        message?.let {
            Playback.message.value = null
            snackbar.showSnackbar(it)
        }
    }
    val open: (Route) -> Unit = { r -> if (TABS.any { it.route == r }) { stack.clear(); stack.add(r) } else stack.add(r) }
    val back: () -> Unit = { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    BackHandler(enabled = stack.size > 1 && !nowPlaying && !queueOpen) { back() }
    Nav.open = open
    // Unread DM badge: refreshed on start and whenever a DM arrives or is read.
    val dmTick by RoomClient.dmTick.collectAsState()
    var unread by remember { mutableStateOf(0) }
    LaunchedEffect(dmTick) { runCatching { Api.unreadCount() }.onSuccess { unread = it } }

    Box(Modifier.fillMaxSize().background(Bg)) {
        Scaffold(
            containerColor = Bg,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                Column {
                    MiniPlayer(onOpen = { nowPlaying = true })
                    NavigationBar(containerColor = Color(0xFF0A0A0D)) {
                        val root = stack.first()
                        TABS.forEach { tab ->
                            NavigationBarItem(
                                selected = root == tab.route,
                                onClick = { open(tab.route) },
                                icon = { Icon(tab.icon, null) },
                                label = { Text(tab.label, fontSize = 11.sp) },
                                colors = NavigationBarItemDefaults.colors(selectedIconColor = Accent, indicatorColor = Bg4),
                            )
                        }
                    }
                }
            },
        ) { pad ->
            // consumeWindowInsets: screens' imePadding() then only adds the part of the keyboard
            // not already covered by the bottom bar padding.
            Column(Modifier.padding(pad).consumeWindowInsets(pad).statusBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val room by RoomClient.room.collectAsState()
                    room?.let { r ->
                        Text(
                            "● Room ${r.optString("code")} · ${r.optJSONArray("members")?.length() ?: 0} listening",
                            color = Accent, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.clip(RoundedCornerShape(50)).background(Color(0x24FF7A50)).clickable { open(Route.Rooms) }.padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { open(Route.Inbox) }) {
                        Box {
                            Icon(Icons.Default.Email, "Messages", tint = Muted)
                            if (unread > 0) Box(Modifier.align(Alignment.TopEnd).padding(start = 12.dp)) { Badge(unread) }
                        }
                    }
                    IconButton(onClick = { open(Route.Profile) }) { Icon(Icons.Default.Person, "Profile", tint = Muted) }
                }
                Box(Modifier.fillMaxSize()) {
                    when (val r = stack.last()) {
                        Route.Home -> HomeScreen(open)
                        Route.Search -> SearchScreen(open)
                        Route.Library -> LibraryScreen(open)
                        Route.Rooms -> RoomsScreen()
                        Route.Import -> ImportScreen()
                        Route.Liked -> LikedScreen(back)
                        Route.Profile -> UserProfileScreen(Api.username ?: "", open, if (stack.size > 1) back else null, onLogout)
                        is Route.PlaylistDetail -> PlaylistScreen(r.id, back)
                        is Route.UserProfile -> key(r) { UserProfileScreen(r.username, open, back) }
                        is Route.People -> key(r) { PeopleScreen(r.username, r.followers, open, back) }
                        Route.Inbox -> InboxScreen(open, back)
                        is Route.Chat -> key(r) { ChatScreen(r.username, open, back) }
                    }
                }
            }
        }
        if (nowPlaying) NowPlaying(onClose = { nowPlaying = false }, onQueue = { queueOpen = true })
        if (queueOpen) QueueSheet(onClose = { queueOpen = false })
        AddToPlaylistDialog()
    }
}

@Composable
private fun MiniPlayer(onOpen: () -> Unit) {
    val t by Playback.current.collectAsState()
    val playing by Playback.isPlaying.collectAsState()
    val pos by Playback.positionMs.collectAsState()
    val dur by Playback.durationMs.collectAsState()
    val track = t ?: return
    Column(Modifier.padding(horizontal = 8.dp, vertical = 4.dp).clip(RoundedCornerShape(8.dp)).background(Bg4).clickable(onClick = onOpen)) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Cover(track.cover, 44.dp)
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(track.title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(track.artist, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = { Playback.toggle() }) {
                Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, if (playing) "Pause" else "Play")
            }
        }
        LinearProgressIndicator(
            progress = { if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f },
            modifier = Modifier.fillMaxWidth().height(2.dp), color = Color.White, trackColor = Color(0x26FFFFFF),
        )
    }
}

@Composable
private fun NowPlaying(onClose: () -> Unit, onQueue: () -> Unit) {
    BackHandler(onBack = onClose)
    val t by Playback.current.collectAsState()
    val playing by Playback.isPlaying.collectAsState()
    val pos by Playback.positionMs.collectAsState()
    val dur by Playback.durationMs.collectAsState()
    val shuffle by Playback.shuffle.collectAsState()
    val repeat by Playback.repeat.collectAsState()
    var dragging by remember { mutableStateOf<Float?>(null) }
    val track = t
    LaunchedEffect(track) { if (track == null) onClose() }
    if (track == null) return
    val inRoom = Playback.inRoom

    Column(
        Modifier.fillMaxSize().background(Brush()).statusBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Default.KeyboardArrowDown, "Close") }
            Text(if (inRoom) "LISTENING ROOM" else "NOW PLAYING", Modifier.weight(1f), color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            IconButton(onClick = onQueue) { Icon(Icons.AutoMirrored.Filled.QueueMusic, "Queue") }
        }
        Spacer(Modifier.weight(1f))
        Cover(track.cover, 300.dp, RoundedCornerShape(12.dp))
        Spacer(Modifier.weight(1f))
        Column(Modifier.fillMaxWidth()) {
            Text(track.title, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(track.artist, color = Muted, fontSize = 16.sp)
        }
        Slider(
            value = dragging ?: (if (dur > 0) pos.toFloat() / dur else 0f),
            onValueChange = { dragging = it },
            onValueChangeFinished = { dragging?.let { Playback.seekTo((it * dur).toLong()) }; dragging = null },
            enabled = !inRoom || RoomClient.isHost,
            colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Color.White),
            modifier = Modifier.padding(top = 12.dp),
        )
        Row(Modifier.fillMaxWidth()) {
            Text(formatTime(((dragging?.times(dur) ?: pos.toFloat()) / 1000).toLong()), color = Muted, fontSize = 12.sp)
            Spacer(Modifier.weight(1f))
            Text(formatTime(dur / 1000), color = Muted, fontSize = 12.sp)
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween) {
            IconButton(onClick = { Playback.toggleShuffle() }, enabled = !inRoom) { Icon(Icons.Default.Shuffle, "Shuffle", tint = if (shuffle) Accent else Muted) }
            IconButton(onClick = { Playback.prev() }) { Icon(Icons.Default.SkipPrevious, "Previous", Modifier.size(36.dp)) }
            Box(Modifier.size(72.dp).clip(CircleShape).background(Color.White).clickable { Playback.toggle() }, contentAlignment = Alignment.Center) {
                Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, if (playing) "Pause" else "Play", tint = Bg, modifier = Modifier.size(40.dp))
            }
            IconButton(onClick = { Playback.next() }) { Icon(Icons.Default.SkipNext, "Next", Modifier.size(36.dp)) }
            IconButton(onClick = { Playback.cycleRepeat() }, enabled = !inRoom) {
                Icon(if (repeat == Player.REPEAT_MODE_ONE) Icons.Default.RepeatOne else Icons.Default.Repeat, "Repeat",
                    tint = if (repeat != Player.REPEAT_MODE_OFF) Accent else Muted)
            }
        }
    }
}

@Composable
private fun Brush() = androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color(0xFF4A2A3A), Bg))

@Composable
private fun QueueSheet(onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val queue by Playback.queue.collectAsState()
    val index by Playback.index.collectAsState()
    val room by RoomClient.room.collectAsState()
    Column(Modifier.fillMaxSize().background(Bg).statusBarsPadding()) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (room != null) "Room queue" else "Queue", fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).padding(start = 8.dp))
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, "Close") }
        }
        val r = room
        LazyColumn(contentPadding = PaddingValues(12.dp)) {
            if (r != null) {
                val items = r.getJSONArray("queue").mapObjects { it }
                if (items.isEmpty()) item { Text("Nothing queued.", color = Muted) }
                itemsIndexed(items) { _, qi ->
                    val t = qi.optJSONObject("track")
                    QueueRow(t?.optString("title") ?: "Unavailable", "${t?.optString("artist") ?: ""} · ${qi.optString("addedBy")}", t?.optStringOrNull("cover"), false, null, null)
                }
            } else {
                if (queue.isEmpty()) item { Text("Your queue is empty.", color = Muted) }
                itemsIndexed(queue) { i, t ->
                    QueueRow(t.title, t.artist, t.cover, i == index, onClick = { Playback.jumpTo(i) }, onRemove = if (i != index) ({ Playback.removeAt(i) }) else null)
                }
            }
        }
    }
}

@Composable
private fun QueueRow(title: String, sub: String, cover: String?, current: Boolean, onClick: (() -> Unit)?, onRemove: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(if (current) Bg3 else Color.Transparent)
            .clickable(enabled = onClick != null) { onClick?.invoke() }.padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(cover, 44.dp)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            Text(title, color = if (current) Accent else MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        onRemove?.let { IconButton(onClick = it) { Icon(Icons.Default.Close, "Remove", tint = Muted) } }
    }
}
