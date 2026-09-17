// Offscreen document: the only place audio can play under MV3 (SPEC 15.2).
// Plays allow-listed sounds only, and only when asked by the extension itself (never by a web page tab).
import { onWorkerMessage, getURL } from '../platform/runtime.js';
import { SOUND_FILES, MSG } from '../core/constants.js';

onWorkerMessage(MSG.PLAY_SOUND, async ({ file, volume }, sender) => {
  if (sender?.tab) return { ok: false, error: 'FORBIDDEN' };
  if (!SOUND_FILES.includes(file)) return { ok: false, error: 'UNKNOWN_SOUND' };
  const audio = new Audio(getURL(file));
  audio.volume = Math.max(0, Math.min(1, Number(volume) || 0));
  try {
    await audio.play();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.name ?? 'PLAY_FAILED') };
  }
});
