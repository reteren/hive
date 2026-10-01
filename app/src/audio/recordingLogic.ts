export type RecordingPhase = "idle" | "requesting" | "recording" | "saving" | "ready" | "error";

export type RecordingEvent =
  | { type: "request" }
  | { type: "started" }
  | { type: "stop" }
  | { type: "saved" }
  | { type: "failed" }
  | { type: "cancel" }
  | { type: "blur"; recordInBackground: boolean }
  | { type: "selection-change" };

/** Small recording state machine, kept pure so all lifecycle branches can be tested. */
export function transitionRecording(phase: RecordingPhase, event: RecordingEvent): RecordingPhase {
  switch (event.type) {
    case "request":
      return phase === "idle" || phase === "ready" || phase === "error" ? "requesting" : phase;
    case "started":
      return phase === "requesting" ? "recording" : phase;
    case "stop":
      return phase === "recording" ? "saving" : phase;
    case "saved":
      return phase === "saving" ? "ready" : phase;
    case "failed":
      return phase === "requesting" || phase === "recording" || phase === "saving" ? "error" : phase;
    case "cancel":
      return phase === "requesting" || phase === "recording" || phase === "saving" ? "idle" : phase;
    case "blur":
      return phase === "recording" && !event.recordInBackground ? "saving" : phase;
    case "selection-change":
      return phase;
  }
}
