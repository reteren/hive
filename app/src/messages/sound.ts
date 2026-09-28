let audio: AudioContext | null = null;
let lastToneAt = -Infinity;

/** Called from a user gesture, so later reminder tones can run under WebAudio autoplay rules. */
export async function prepareMessageSound(): Promise<void> {
  if (typeof AudioContext === "undefined") return;
  try {
    if (!audio || audio.state === "closed") audio = new AudioContext();
    if (audio.state === "suspended") await audio.resume();
  } catch { /* A blocked/unavailable audio device must not suppress the message. */ }
}

/** A short quiet sine tone. Simultaneous reminder cards share one soft tone. */
export async function playMessageSound(): Promise<boolean> {
  if (typeof AudioContext === "undefined") return false;
  try { if (!audio || audio.state === "closed") audio = new AudioContext(); } catch { return false; }
  if (!audio || audio.state !== "running" || Date.now() - lastToneAt < 350) return false;
  try {
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    const at = audio.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, at);
    volume.gain.setValueAtTime(0, at);
    volume.gain.linearRampToValueAtTime(0.035, at + 0.025);
    volume.gain.linearRampToValueAtTime(0, at + 0.24);
    oscillator.connect(volume); volume.connect(audio.destination);
    oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
    oscillator.start(at); oscillator.stop(at + 0.25);
    lastToneAt = Date.now();
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
