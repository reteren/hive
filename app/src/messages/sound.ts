let audio: AudioContext | null = null;
let scheduledUntil = 0;

const MESSAGE_TONE_DURATION_SECONDS = 0.25;
// A 450 ms cadence leaves a clearly audible 200 ms pause after each tone.
const MESSAGE_TONE_INTERVAL_SECONDS = 0.45;

/** Called from a user gesture, so later reminder tones can run under WebAudio autoplay rules. */
export async function prepareMessageSound(): Promise<void> {
  if (typeof AudioContext === "undefined") return;
  try {
    if (!audio || audio.state === "closed") { audio = new AudioContext(); scheduledUntil = 0; }
    if (audio.state === "suspended") await audio.resume();
  } catch { /* A blocked/unavailable audio device must not suppress the message. */ }
}

/** Importance plays 1–5 quiet tones; simultaneous cards queue rather than overlap. */
export async function playMessageSound(count = 1): Promise<boolean> {
  if (typeof AudioContext === "undefined") return false;
  try { if (!audio || audio.state === "closed") { audio = new AudioContext(); scheduledUntil = 0; } } catch { return false; }
  if (!audio || audio.state !== "running") return false;
  try {
    const repeats = Number.isFinite(count) ? Math.min(5, Math.max(1, Math.trunc(count))) : 1;
    const start = Math.max(audio.currentTime, scheduledUntil);
    for (let index = 0; index < repeats; index += 1) {
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      const at = start + index * MESSAGE_TONE_INTERVAL_SECONDS;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, at);
      volume.gain.setValueAtTime(0, at);
      volume.gain.linearRampToValueAtTime(0.035, at + 0.025);
      volume.gain.linearRampToValueAtTime(0, at + 0.24);
      oscillator.connect(volume); volume.connect(audio.destination);
      oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
      oscillator.start(at); oscillator.stop(at + MESSAGE_TONE_DURATION_SECONDS);
    }
    // Keep subsequent cards behind the final tone with the same audible gap.
    scheduledUntil = start + repeats * MESSAGE_TONE_INTERVAL_SECONDS;
    return true;
  } catch { return false; }
}

/** Warm the context on interaction, without playing a sound or taking focus. */
export function installMessageSoundUnlock(root: Document): () => void {
  const unlock = () => { void prepareMessageSound(); };
  // Board gestures stop bubbling; capture still observes the real user interaction.
  root.addEventListener("pointerdown", unlock, { passive: true, capture: true });
  root.addEventListener("keydown", unlock, { passive: true, capture: true });
  return () => { root.removeEventListener("pointerdown", unlock, { capture: true }); root.removeEventListener("keydown", unlock, { capture: true }); };
}
