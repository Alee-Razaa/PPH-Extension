// Sound through a single reusable offscreen document. Never throws. SPEC 15.2.
// Do not close the document: an AUDIO_PLAYBACK document closes itself 30 s after playback ends.

const DOCUMENT_PATH = 'offscreen/offscreen.html';
let creating = null;                                  // two alerts in one wake must not create twice

async function ensureDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(DOCUMENT_PATH)]
  });
  if (existing.length) return;
  creating ??= chrome.offscreen.createDocument({
    url: DOCUMENT_PATH,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play an alert tone when a new freelance job is posted.'
  }).finally(() => { creating = null; });
  await creating;
}

/** @returns {Promise<{ ok: boolean, error?: string }>} */
export async function playSound(file, volume) {
  try {
    await ensureDocument();
    const message = { type: 'PLAY_SOUND', file, volume };
    // The document's module script can lag creation slightly. One retry, no loop.
    let reply = await chrome.runtime.sendMessage(message).catch(() => null);
    if (!reply) {
      await new Promise(resolve => setTimeout(resolve, 150));
      reply = await chrome.runtime.sendMessage(message).catch(() => null);
    }
    return reply ?? { ok: false, error: 'NO_REPLY' };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 80) };
  }
}
