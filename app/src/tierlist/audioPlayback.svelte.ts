export const tierlistAudioPlayback = $state({
  key: null as string | null,
  audio: null as HTMLAudioElement | null,
  playing: false,
  unavailableKey: null as string | null,
});

/** One inline player is shared by every Tierlist, so starting a card pauses the previous one. */
export async function toggleTierlistAudio(key: string, url: string): Promise<void> {
  if (!url || typeof Audio === "undefined") return;
  const current = tierlistAudioPlayback.audio;
  if (tierlistAudioPlayback.key === key && current) {
    tierlistAudioPlayback.unavailableKey = null;
    if (current.paused) {
      try {
        await current.play();
      } catch {
        tierlistAudioPlayback.playing = false;
        tierlistAudioPlayback.unavailableKey = key;
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
  tierlistAudioPlayback.unavailableKey = null;
  audio.onplay = () => {
    if (tierlistAudioPlayback.audio === audio) tierlistAudioPlayback.playing = true;
  };
  audio.onpause = () => {
    if (tierlistAudioPlayback.audio === audio) tierlistAudioPlayback.playing = false;
  };
  audio.onended = () => {
    if (tierlistAudioPlayback.audio === audio) tierlistAudioPlayback.playing = false;
  };
  try {
    await audio.play();
  } catch {
    if (tierlistAudioPlayback.audio === audio) {
      tierlistAudioPlayback.audio = null;
      tierlistAudioPlayback.playing = false;
      tierlistAudioPlayback.unavailableKey = key;
    }
  }
}

export function stopTierlistAudioFor(noteId: string): void {
  if (!tierlistAudioPlayback.key?.startsWith(`${noteId}:`)) return;
  tierlistAudioPlayback.audio?.pause();
  tierlistAudioPlayback.key = null;
  tierlistAudioPlayback.audio = null;
  tierlistAudioPlayback.playing = false;
  tierlistAudioPlayback.unavailableKey = null;
}
