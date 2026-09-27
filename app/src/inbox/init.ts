import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { mount } from "svelte";
import { registerCommand } from "../commands/registry.svelte";
import { registerNodeBody } from "../notes/nodeBodies";
import { registerSelectionInteractionListener } from "../selection/selection.svelte";
import InboxNodeBody from "./InboxNodeBody.svelte";
import InboxQuickInputDialog from "./InboxQuickInputDialog.svelte";
import InboxTwinMarkerHost from "./InboxTwinMarkerHost.svelte";
import { resolveInboxInteraction, submitQuickInput } from "./inbox.svelte";
import { openQuickInputPrompt } from "./quickInputState.svelte";
import {
  QUICK_INPUT_EVENT,
  QUICK_INPUT_RESULT_EVENT,
  type QuickInputRequest,
  type QuickInputResult,
} from "../quickInput/submission";
import "./inbox.css";

registerNodeBody("inbox", InboxNodeBody);
registerSelectionInteractionListener((noteIds, source) => resolveInboxInteraction(noteIds, source));

registerCommand({
  id: "inbox.quickInput",
  label: "Quick input to Inbox",
  keys: [],
  run: openQuickInputPrompt,
});

const promptHost = document.createElement("div");
promptHost.dataset.inboxPromptHost = "";
document.body.append(promptHost);
mount(InboxQuickInputDialog, { target: promptHost });
mount(InboxTwinMarkerHost, { target: promptHost });

if (isTauri()) {
  try {
    await listen<QuickInputRequest>(QUICK_INPUT_EVENT, ({ payload }) => {
      if (typeof payload?.requestId !== "string" || typeof payload.text !== "string") return;

      let response: QuickInputResult;
      try {
        const result = submitQuickInput(payload.text);
        response = result.ok
          ? { requestId: payload.requestId, ok: true }
          : { requestId: payload.requestId, ok: false, error: result.error };
      } catch (error) {
        console.error("Could not save quick input to Inbox", error);
        response = {
          requestId: payload.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      void emit(QUICK_INPUT_RESULT_EVENT, response).catch((error: unknown) => {
        console.error("Could not reply to the quick-input window", error);
      });
    });
  } catch (error) {
    console.error("Could not register the quick-input listener", error);
  }
}
