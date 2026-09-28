<script lang="ts">
  import { quickInputPrompt, closeQuickInputPrompt } from "./quickInputState.svelte";
  import { submitQuickInput } from "./inbox.svelte";

  let inputElement = $state<HTMLTextAreaElement>();

  $effect(() => {
    if (!quickInputPrompt.open) return;
    const frame = requestAnimationFrame(() => inputElement?.focus());
    return () => cancelAnimationFrame(frame);
  });

  function submit(event?: Event): void {
    event?.preventDefault();
    const result = submitQuickInput(quickInputPrompt.text);
    if (!result.ok) {
      quickInputPrompt.error = "No Inbox node found. Create an Inbox node, then submit this text again.";
      inputElement?.focus();
      return;
    }
    quickInputPrompt.text = "";
    quickInputPrompt.error = "";
    closeQuickInputPrompt();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeQuickInputPrompt();
    } else if (event.key === "Enter" && !event.shiftKey) {
      // Same keys as the separate quick input window: Enter adds, Shift+Enter is a new line.
      submit(event);
    }
  }
</script>

{#if quickInputPrompt.open}
  <div class="inbox-prompt-shade" data-inbox-quick-input-shade data-selection-ignore>
    <div
      class="inbox-prompt"
      data-inbox-quick-input-dialog
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="inbox-quick-input-title"
      onkeydown={handleKeydown}
    >
      <header>
        <h2 id="inbox-quick-input-title">Quick input to Inbox</h2>
        <button type="button" class="inbox-prompt-close" aria-label="Close quick input" onclick={closeQuickInputPrompt}>×</button>
      </header>
      <form onsubmit={submit}>
        <label for="inbox-quick-input-text">Text</label>
        <textarea
          id="inbox-quick-input-text"
          bind:this={inputElement}
          bind:value={quickInputPrompt.text}
          data-inbox-quick-input-text
          rows="5"
          placeholder="Write an idea or reminder…"
        ></textarea>
        {#if quickInputPrompt.error}
          <p class="inbox-prompt-error" data-inbox-quick-input-error role="alert">{quickInputPrompt.error}</p>
        {/if}
        <footer>
          <button type="button" class="inbox-prompt-cancel" onclick={closeQuickInputPrompt}>Cancel</button>
          <button type="submit" class="inbox-prompt-submit" data-inbox-quick-input-submit>Add to Inbox</button>
        </footer>
      </form>
    </div>
  </div>
{/if}

<style>
  .inbox-prompt-shade {
    position: fixed;
    z-index: 120;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgb(0 0 0 / 48%);
  }

  .inbox-prompt {
    width: min(460px, 100%);
    padding: 12px;
    border: 1px solid #555;
    border-radius: 5px;
    color: var(--text);
    background: #242424;
    box-shadow: 0 12px 40px rgb(0 0 0 / 38%);
  }

  .inbox-prompt header,
  .inbox-prompt footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .inbox-prompt h2 { margin: 0; font-size: 13px; font-weight: 600; }
  .inbox-prompt form { display: grid; gap: 8px; margin-top: 12px; }
  .inbox-prompt label { color: var(--text-dim); font-size: 10px; }
  .inbox-prompt textarea {
    width: 100%;
    min-height: 100px;
    box-sizing: border-box;
    resize: vertical;
    padding: 8px;
    border: 1px solid #4a4a4a;
    border-radius: 3px;
    color: var(--text);
    background: #1a1a1a;
    font: inherit;
    line-height: 1.4;
  }

  .inbox-prompt button {
    padding: 5px 8px;
    border: 1px solid #555;
    border-radius: 3px;
    color: var(--text);
    background: #303030;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .inbox-prompt .inbox-prompt-submit { border-color: #637a46; background: #38442e; }
  .inbox-prompt .inbox-prompt-close { padding: 1px 6px; font-size: 16px; }
  .inbox-prompt-error { margin: 0; color: #edaaa0; font-size: 10px; }
</style>
