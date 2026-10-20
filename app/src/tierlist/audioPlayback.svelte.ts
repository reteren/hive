import { pinNote } from "../board/visibility.svelte";
import { t } from "../i18n/i18n.svelte";

export const tierlistAudioPlayback = $state({
  key: null as string | null,
  audio: null as HTMLAudioElement | null,
  playing: false,
  errorKey: null as string | null,
  error: "",
});
let releasePinnedNote: (() => void) | null = null;

/** One inline player is shared by every Tierlist, so starting a card pauses the previous one. */
export async function toggleTierlistAudio(key: string, url: string, noteId?: string): Promise<void> {
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
  releasePinnedNote?.();
  releasePinnedNote = null;
  const audio = new Audio();
  // The player is created only in response to a play action, so metadata loading is now intentional.
  audio.preload = "auto";
  audio.src = url;
  tierlistAudioPlayback.key = key;
  tierlistAudioPlayback.audio = audio;
  tierlistAudioPlayback.playing = false;
  tierlistAudioPlayback.errorKey = null;
  tierlistAudioPlayback.error = "";
  audio.onplay = () => {
    if (tierlistAudioPlayback.audio === audio) {
      tierlistAudioPlayback.playing = true;
      releasePinnedNote?.();
      if (noteId) releasePinnedNote = pinNote(noteId, t("tierlist audio playback"));
    }
  };
  audio.onpause = () => {
    if (tierlistAudioPlayback.audio === audio) {
      tierlistAudioPlayback.playing = false;
      releasePinnedNote?.();
      releasePinnedNote = null;
    }
  };
  audio.onended = () => {
    if (tierlistAudioPlayback.audio === audio) {
      tierlistAudioPlayback.playing = false;
      releasePinnedNote?.();
      releasePinnedNote = null;
    }
  };
  audio.onerror = () => reportPlaybackError(key, audio, audio.error?.message || t("The audio file could not be loaded."));
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
  releasePinnedNote?.();
  releasePinnedNote = null;
  tierlistAudioPlayback.errorKey = key;
  tierlistAudioPlayback.error = reason;
}

export function stopTierlistAudioFor(noteId: string): void {
  if (!tierlistAudioPlayback.key?.startsWith(`${noteId}:`)) return;
  tierlistAudioPlayback.audio?.pause();
  releasePinnedNote?.();
  releasePinnedNote = null;
  tierlistAudioPlayback.key = null;
  tierlistAudioPlayback.audio = null;
  tierlistAudioPlayback.playing = false;
  tierlistAudioPlayback.errorKey = null;
  tierlistAudioPlayback.error = "";
}
