import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Settings → Media → Recording format. The webview records WebM/Opus only; every other format is
 * made after the recording stops: the WebM is decoded to PCM here and encoded by Rust
 * (src-tauri/src/audio_encode.rs).
 */
export const RECORDING_FORMATS = ["mp3", "ogg", "webm", "wav", "flac"] as const;
export type RecordingFormat = (typeof RECORDING_FORMATS)[number];
export const DEFAULT_RECORDING_FORMAT: RecordingFormat = "mp3";

export const RECORDING_FORMAT_LABELS: Record<RecordingFormat, string> = {
  mp3: "MP3",
  ogg: "OGG",
  webm: "WebM",
  wav: "WAV",
  flac: "FLAC",
};

const MIME: Record<RecordingFormat, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  webm: "audio/webm",
  wav: "audio/wav",
  flac: "audio/flac",
};

/** Opus decodes natively at 48 kHz, so decoding there avoids a resampling step. */
const DECODE_SAMPLE_RATE = 48_000;

export function normalizeRecordingFormat(value: unknown, fallback: RecordingFormat = DEFAULT_RECORDING_FORMAT): RecordingFormat {
  return typeof value === "string" && (RECORDING_FORMATS as readonly string[]).includes(value) ? value as RecordingFormat : fallback;
}

export interface EncodedRecording {
  bytes: Uint8Array;
  mime: string;
  extension: RecordingFormat;
  /** Exact length when the audio was decoded; undefined for the WebM kept as recorded. */
  duration?: number;
}

/** Interleave up to two channels as little-endian 16-bit PCM. */
export function interleavePcm16(channels: readonly Float32Array[]): Uint8Array {
  const used = channels.slice(0, 2);
  const frames = used[0]?.length ?? 0;
  const out = new DataView(new ArrayBuffer(frames * used.length * 2));
  let offset = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of used) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      out.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(out.buffer);
}

/** Turn the recorded WebM into the chosen format. Outside the desktop app the WebM is kept. */
export async function encodeRecording(webm: Uint8Array, format: RecordingFormat): Promise<EncodedRecording> {
  if (format === "webm" || !isTauri()) return { bytes: webm, mime: MIME.webm, extension: "webm" };
  const context = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
  const decoded = await context.decodeAudioData(webm.slice().buffer);
  const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, index) => decoded.getChannelData(index));
  const encoded = await invoke<ArrayBuffer>("audio_encode_recording", interleavePcm16(channels), {
    headers: {
      "x-hive-format": format,
      "x-hive-rate": String(decoded.sampleRate),
      "x-hive-channels": String(channels.length),
    },
  });
  return { bytes: new Uint8Array(encoded), mime: MIME[format], extension: format, duration: decoded.duration };
}
