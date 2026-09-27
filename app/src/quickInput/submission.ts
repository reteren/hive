export const QUICK_INPUT_EVENT = "hive://quick-input";
export const QUICK_INPUT_RESULT_EVENT = "hive://quick-input-result";
export const NO_INBOX_ERROR = "No Inbox node in the open project — create one with Q → Inbox.";

export interface QuickInputRequest {
  text: string;
  requestId: string;
}

export interface QuickInputResult {
  requestId: string;
  ok: boolean;
  error?: string;
}

export interface QuickInputSubmissionState {
  text: string;
  requestId: string | null;
  error: string;
}

export function initialSubmissionState(text = ""): QuickInputSubmissionState {
  return { text, requestId: null, error: "" };
}

export function startSubmission(
  state: QuickInputSubmissionState,
  requestId: string,
): { state: QuickInputSubmissionState; request: QuickInputRequest | null } {
  if (state.requestId !== null || state.text.trim().length === 0) {
    return { state, request: null };
  }

  return {
    state: { ...state, requestId, error: "" },
    request: { text: state.text, requestId },
  };
}

export function finishSubmission(
  state: QuickInputSubmissionState,
  result: QuickInputResult,
): QuickInputSubmissionState {
  if (state.requestId !== result.requestId) return state;
  if (result.ok) return initialSubmissionState();

  return {
    ...state,
    requestId: null,
    error: result.error === "no-inbox" ? NO_INBOX_ERROR : result.error || "Could not add the note. Try again.",
  };
}
