export const tierlistAudioPlayback = $state({
  key: null as string | null,
  audio: null as HTMLAudioElement | null,
  playing: false,
  errorKey: null as string | null,
  error: "",
});

/** One inline player is shared by every Tierlist, so starting a card pauses the previous one. */
export async function toggleTierlistAudio(key: string, url: string): Promise<void> {
  if (!url || typeof Audio === "undefined") return;
  const current = tierlistAudioPlayback.audio;
  if (tierlistAudioPlayback.key === key && current) {
    tierlistAudioPlayback.errorKey = null;
    tierlistAudioPlayback.error = "";
    if (current.paused) {
      try {
        await current.play();
      } catch (error) {
        reportPlaybackError(key, current, error);
      }
    } else {
      current.pause();
    }
    return;
  }

  current?.pause();
  const audio = new Audio(url);
  tierlistAudioPlayback.key = key;
  tierlistAudioPlayback.audio = audio;
  tierlistAudioPlayback.playing = false;
  tierlistAudioPlayback.errorKey = null;
  tierlistAudioPlayback.error = "";
  audio.preload = "auto";
  audio.onplay = () => {
    if (tierlistAudioPlayback.audio === audio) tierlistAudioPlayback.playing = true;
  };
  audio.onpause = () => {
    if (tierlistAudioPlayback.audio === audio) tierlistAudioPlayback.playing = false;
  };
  audio.onended = () => {
    if (tierlistAudioPlayback.audio === audio) tierlistAudioPlayback.playing = false;
  };
  audio.onerror = () => reportPlaybackError(key, audio, audio.error?.message || "The audio file could not be loaded.");
  try {
    await audio.play();
  } catch (error) {
    reportPlaybackError(key, audio, error);
  }
}

function reportPlaybackError(key: string, audio: HTMLAudioElement, error: unknown): void {
  if (tierlistAudioPlayback.audio !== audio) return;
  const reason = error instanceof Error ? error.message : String(error || "The audio file could not be played.");
  console.warn("Tierlist audio playback failed.", {
    url: audio.currentSrc || audio.src,
    error: reason,
  });
  tierlistAudioPlayback.playing = false;
  tierlistAudioPlayback.errorKey = key;
  tierlistAudioPlayback.error = reason;
}

export function stopTierlistAudioFor(noteId: string): void {
  if (!tierlistAudioPlayback.key?.startsWith(`${noteId}:`)) return;
  tierlistAudioPlayback.audio?.pause();
  tierlistAudioPlayback.key = null;
  tierlistAudioPlayback.audio = null;
  tierlistAudioPlayback.playing = false;
  tierlistAudioPlayback.errorKey = null;
  tierlistAudioPlayback.error = "";
}
