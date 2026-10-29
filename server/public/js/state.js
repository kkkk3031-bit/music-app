// Shared app state + a tiny pub/sub so views can react to changes made
// elsewhere (playlist created in the sidebar, liked from the player bar…).
import { get } from './api.js';

export const state = {
  user: null,
  playlists: [], // my playlists (sidebar + "add to playlist" menus)
  player: null,
  rooms: null, // RoomClient
  health: { features: {} },
};

const bus = new EventTarget();
export const on = (type, fn) => {
  bus.addEventListener(type, fn);
  return () => bus.removeEventListener(type, fn);
};
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export async function refreshPlaylists() {
  state.playlists = await get('/playlists');
  emit('playlists');
  return state.playlists;
}
