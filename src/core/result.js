// Result type: errors are values, never thrown across module boundaries. SPEC 25.1.

/** @returns {{ ok: true, value: any }} */
export const ok = value => Object.freeze({ ok: true, value });

/** @returns {{ ok: false, error: string }} */
export const err = error => Object.freeze({ ok: false, error: String(error) });

/** Run fn, capturing a throw as err(message). */
export function attempt(fn) {
  try {
    return ok(fn());
  } catch (e) {
    return err(e?.message ?? e);
  }
}
