<script lang="ts">
  import { onMount } from "svelte";
  import { emitTo, listen } from "@tauri-apps/api/event";
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    finishSubmission,
    initialSubmissionState,
    QUICK_INPUT_EVENT,
    QUICK_INPUT_RESULT_EVENT,
    startSubmission,
    type QuickInputResult,
    type QuickInputSubmissionState,
  } from "./submission";

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let submission = $state<QuickInputSubmissionState>(initialSubmissionState());
  let sending = $derived(submission.requestId !== null);

  onMount(() => {
    if (!isTauri()) return;

    let disposed = false;
    const cleanups: Array<() => void> = [];
    const keepCleanup = (promise: Promise<() => void>) => {
      void promise.then((cleanup) => {
        if (disposed) cleanup();
        else cleanups.push(cleanup);
      }).catch((error: unknown) => console.error("Could not register quick input window event.", error));
    };

    const currentWindow = getCurrentWindow();
    keepCleanup(listen<QuickInputResult>(QUICK_INPUT_RESULT_EVENT, async ({ payload }) => {
      const isCurrentRequest = submission.requestId === payload.requestId;
      submission = finishSubmission(submission, payload);
      if (isCurrentRequest && payload.ok) await currentWindow.hide();
      else if (isCurrentRequest) focusInput();
    }));
    keepCleanup(listen("hive://quick-input-focus", () => focusInput()));
    keepCleanup(currentWindow.onFocusChanged(({ payload }) => {
      if (payload) focusInput();
    }));
    keepCleanup(currentWindow.onCloseRequested((event) => {
      event.preventDefault();
      void currentWindow.hide();
    }));

    requestAnimationFrame(focusInput);
    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  });

  function focusInput(): void {
    requestAnimationFrame(() => textarea?.focus());
  }

  async function submit(): Promise<void> {
    const started = startSubmission(submission, crypto.randomUUID());
    if (!started.request) return;
    submission = started.state;
    try {
      await emitTo("main", QUICK_INPUT_EVENT, started.request);
    } catch (error) {
      submission = finishSubmission(submission, {
        requestId: started.request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      void getCurrentWindow().hide();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && event.target === textarea) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="quick-input" data-quick-input-window data-selection-ignore>
  <header class="quick-input__header">
    <div>
      <p class="quick-input__eyebrow">hive · Inbox</p>
      <h1>Quick input</h1>
    </div>
    <button class="quick-input__close" type="button" aria-label="Hide quick input" title="Hide quick input" onclick={() => void getCurrentWindow().hide()}>×</button>
  </header>

  <textarea
    bind:this={textarea}
    bind:value={submission.text}
    class="quick-input__text"
    placeholder="Capture a thought…"
    aria-label="Text to add to the Inbox"
    aria-describedby="quick-input-help"
  ></textarea>

  <footer class="quick-input__footer">
    <p id="quick-input-help">Enter to add · Shift+Enter for a new line · Esc to hide</p>
    <button class="quick-input__submit" type="button" disabled={sending || submission.text.trim().length === 0} onclick={() => void submit()}>
      {sending ? "Adding…" : "Add note"}
    </button>
  </footer>
  {#if submission.error}
    <p class="quick-input__error" role="alert" aria-live="assertive">{submission.error}</p>
  {/if}
</main>

<style>
  :global(html), :global(body), :global(#app) {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: #161616;
  }

  .quick-input {
    box-sizing: border-box;
    display: flex;
    width: 100%;
    height: 100%;
    flex-direction: column;
    gap: 10px;
    padding: 13px 15px 12px;
    border: 1px solid #3d3d3d;
    background: #1d1d1d;
    color: #ededed;
    font-family: Inter, "Segoe UI", sans-serif;
  }

  .quick-input__header,
  .quick-input__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .quick-input__eyebrow {
    margin: 0 0 2px;
    color: #a7a7a7;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .quick-input__close {
    width: 25px;
    height: 25px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: #aaa;
    font-size: 19px;
    line-height: 1;
    cursor: pointer;
  }

  .quick-input__close:hover,
  .quick-input__close:focus-visible {
    border-color: #555;
    background: #303030;
    color: #fff;
  }

  .quick-input__text {
    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    flex: 1;
    resize: none;
    padding: 9px 10px;
    border: 1px solid #494949;
    border-radius: 3px;
    outline: none;
    background: #151515;
    color: #ededed;
    font: 12px/1.45 Inter, "Segoe UI", sans-serif;
  }

  .quick-input__text:focus {
    border-color: #8e742b;
    box-shadow: 0 0 0 1px #8e742b;
  }

  .quick-input__text::placeholder {
    color: #777;
  }

  .quick-input__footer p {
    margin: 0;
    color: #999;
    font-size: 9px;
  }

  .quick-input__submit {
    min-height: 27px;
    padding: 4px 10px;
    border: 1px solid #776327;
    border-radius: 3px;
    background: #3a321d;
    color: #f1df9e;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .quick-input__submit:hover:not(:disabled),
  .quick-input__submit:focus-visible {
    background: #504426;
  }

  .quick-input__submit:disabled {
    border-color: #414141;
    background: #272727;
    color: #777;
    cursor: default;
  }

  .quick-input__error {
    margin: -3px 0 0;
    color: #ffaaa0;
    font-size: 10px;
    line-height: 1.35;
  }
</style>
