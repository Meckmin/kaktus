/**
 * Checks the in-app video setup against the real Daily API, with the same
 * client code the app uses. Run after setting DAILY_API_KEY:
 *
 *   npx tsx --env-file=.env scripts/daily-smoke.mts
 *
 * Creates one throwaway room (deleted at the end) and verifies: the room is
 * private, its join window is what we asked for, a token is scoped to it, the
 * presence and attendance endpoints answer in the shape the app parses, and a
 * re-time of an existing room works. Prints no secrets. Exits 1 on failure.
 */
import { createMeetingToken, roomAttendance, roomPresence, upsertRoom } from '../src/lib/meetings/daily';

const API = 'https://api.daily.co/v1';
const key = process.env.DAILY_API_KEY?.trim();
if (!key) {
  console.error('✗ DAILY_API_KEY is not set');
  process.exit(1);
}

let failed = 0;
const check = (ok: unknown, label: string, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n    → ${detail}` : ''}`);
  if (!ok) failed++;
};

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const name = `kk-smoke-${Date.now().toString(36)}`;
const now = Date.now();
const opensAt = new Date(now - 5 * 60_000);
const closesAt = new Date(now + 60 * 60_000);

try {
  const me = await api('/');
  check(me.status === 200, 'API key is accepted', `HTTP ${me.status}`);
  if (me.status !== 200) process.exit(1);
  console.log(`  domain: ${me.body?.domain_name ?? '?'}`);

  const room = await upsertRoom({ name, opensAt, closesAt });
  check(room.name === name && room.url.includes(name), 'Room is created on first join', JSON.stringify(room));

  const info = await api(`/rooms/${name}`);
  const cfg = info.body?.config ?? {};
  check(info.body?.privacy === 'private', 'Room is private (the URL alone gets nobody in)', `privacy=${info.body?.privacy}`);
  check(cfg.nbf === Math.floor(opensAt.getTime() / 1000), 'Room opens when asked (nbf)', `nbf=${cfg.nbf}`);
  check(cfg.exp === Math.floor(closesAt.getTime() / 1000), 'Room closes when asked (exp)', `exp=${cfg.exp}`);
  check(cfg.eject_at_room_exp === true, 'People are ejected when the room closes');
  check(cfg.lang === 'tr', 'Prebuilt UI is in Turkish', `lang=${cfg.lang}`);
  check(!cfg.enable_recording, 'Recording is off');
  check(cfg.max_participants === 4, 'Room is capped at 4', `max_participants=${cfg.max_participants}`);

  const later = new Date(closesAt.getTime() + 30 * 60_000);
  await upsertRoom({ name, opensAt, closesAt: later });
  const retimed = await api(`/rooms/${name}`);
  check(retimed.body?.config?.exp === Math.floor(later.getTime() / 1000), 'Re-timing an existing room works (moved session)');

  const token = await createMeetingToken({ roomName: name, userId: 'smoke_user', userName: 'Duman Testi', isOwner: false, expiresAt: closesAt });
  const decoded = await api(`/meeting-tokens/${token}`);
  check(decoded.status === 200, 'Token is valid', `HTTP ${decoded.status}`);
  check(decoded.body?.room_name === name, 'Token is scoped to this room only', `room_name=${decoded.body?.room_name}`);
  check(decoded.body?.user_id === 'smoke_user', 'Token carries our user id (for presence/attendance)', `user_id=${decoded.body?.user_id}`);
  check(decoded.body?.is_owner === false, 'Student token has no owner rights');
  check(decoded.body?.exp === Math.floor(closesAt.getTime() / 1000), 'Token expires with the join window');

  const present = await roomPresence(name);
  check(Array.isArray(present) && present.length === 0, 'Presence endpoint answers (empty room)', JSON.stringify(present));
  check((await roomPresence(`${name}-missing`)).length === 0, 'Presence of a room never created is empty, not an error');

  const attendance = await roomAttendance(name, opensAt, later);
  check(Array.isArray(attendance), 'Attendance (meetings) endpoint answers', JSON.stringify(attendance));
} catch (error) {
  check(false, 'Unexpected error', error instanceof Error ? error.message : String(error));
} finally {
  const del = await api(`/rooms/${name}`, { method: 'DELETE' });
  check(del.status === 200 || del.status === 404, 'Throwaway room deleted', `HTTP ${del.status}`);
}

console.log(failed === 0 ? '\nDaily setup looks right.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
