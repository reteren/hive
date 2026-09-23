<script lang="ts">
  import { tick } from "svelte";
  import { bindingFromEvent, editKeyBinding, type KeyBindingConflict } from "../commands/keymap";
  import { closeKeymapPanel, keymapPanelState } from "../commands/keymapPanel.svelte";
  import { formatKey } from "../commands/keys";
  import {
    getCommandKeyOverrides,
    getCommands,
    resetAllCommandKeyOverrides,
    resetCommandKeyOverride,
    setCommandKeyOverrides,
  } from "../commands/registry.svelte";

  let closeButton = $state<HTMLButtonElement>();
  let commands = $derived(getCommands());
  let overrides = $derived(getCommandKeyOverrides());
  let capturing = $state<{ commandId: string; bindingIndex: number | null } | null>(null);
  let pending = $state<{ commandId: string; bindingIndex: number | null; binding: string; conflicts: KeyBindingConflict[] } | null>(null);
  let status = $state("");

  $effect(() => {
    if (!keymapPanelState.open) return;
    void tick().then(() => closeButton?.focus());
  });

  async function close(): Promise<void> {
    capturing = null;
    pending = null;
    const returnFocus = closeKeymapPanel();
    await tick();
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  function startCapture(commandId: string, bindingIndex: number | null): void {
    capturing = { commandId, bindingIndex };
    pending = null;
    status = "Press a key combination; Escape cancels capture.";
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.code === "Escape" && pending) {
      event.preventDefault();
      event.stopPropagation();
      resolveConflict(false);
      return;
    }

    if (capturing) {
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        capturing = null;
        status = "Capture cancelled.";
        return;
      }

      const binding = bindingFromEvent(event);
      if (!binding) {
        event.stopPropagation();
        if (event.code === "Tab") {
          capturing = null;
          status = "Tab is reserved for focus navigation; capture cancelled.";
        } else {
          status = "Choose a non-modifier key; Meta is not supported.";
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const target = capturing;
      const result = editKeyBinding(commands, overrides, target.commandId, target.bindingIndex, binding);
      if (result.error) {
        status = result.error;
        return;
      }
      if (result.conflicts.length > 0) {
        pending = { ...target, binding, conflicts: result.conflicts };
        status = "This binding is already assigned.";
        return;
      }
      if (result.overrides) setCommandKeyOverrides(result.overrides);
      capturing = null;
      status = `Assigned ${formatKey(binding)}.`;
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void close();
    }
  }

  function resolveConflict(replace: boolean): void {
    const conflict = pending;
    if (!conflict) return;
    if (replace) {
      const result = editKeyBinding(
        commands,
        overrides,
        conflict.commandId,
        conflict.bindingIndex,
        conflict.binding,
        true,
      );
      if (result.overrides) setCommandKeyOverrides(result.overrides);
      status = `Assigned ${formatKey(conflict.binding)}; removed it from the previous command.`;
    } else {
      status = "Binding change cancelled.";
    }
    pending = null;
    capturing = null;
  }

  function resetOne(commandId: string): void {
    resetCommandKeyOverride(commandId);
    status = "Command bindings reset to defaults.";
  }
</script>

{#if keymapPanelState.open}
  <div class="keymap-overlay">
    <button class="keymap-backdrop" type="button" aria-label="Close keymap editor" onclick={() => void close()}></button>
    <dialog open class="keymap-panel" aria-modal="true" aria-labelledby="keymap-title" onkeydown={handleKeydown}>
      <header class="keymap-heading">
        <div>
          <h2 id="keymap-title">Key bindings</h2>
          <span>Click a binding, then press a key combination.</span>
        </div>
        <div class="heading-actions">
          <button type="button" class="reset-all" onclick={() => { resetAllCommandKeyOverrides(); status = "All commands reset to defaults."; }}>Reset all</button>
          <button bind:this={closeButton} type="button" class="close-button" aria-label="Close keymap editor" onclick={() => void close()}>×</button>
        </div>
      </header>

      {#if pending}
        <div class="conflict-dialog" role="alertdialog" aria-label="Resolve binding conflict">
          <div>
            <strong>{formatKey(pending.binding)} is already assigned</strong>
            <p>{pending.conflicts.map((conflict) => conflict.label).join(", ")}</p>
          </div>
          <div class="conflict-actions">
            <button type="button" onclick={() => resolveConflict(false)}>Cancel</button>
            <button type="button" class="replace-button" onclick={() => resolveConflict(true)}>Replace</button>
          </div>
        </div>
      {/if}

      <div class="keymap-list" aria-label="Registered commands">
        {#each commands as command (command.id)}
          <article class="keymap-row">
            <div class="command-copy">
              <span class="command-label">{command.label}</span>
              <code>{command.id}</code>
            </div>
            <div class="binding-list" aria-label={`${command.label} bindings`}>
              {#each command.keys as key, index (`${command.id}:${index}`)}
                <button
                  type="button"
                  class="binding-button"
                  class:capturing={capturing?.commandId === command.id && capturing.bindingIndex === index}
                  aria-label={`Change ${command.label} binding ${formatKey(key)}`}
                  onclick={() => startCapture(command.id, index)}
                >{capturing?.commandId === command.id && capturing.bindingIndex === index ? "Press key…" : formatKey(key)}</button>
              {/each}
              {#if command.keys.length === 0}<span class="unbound">Unbound</span>{/if}
              <button
                type="button"
                class="add-binding"
                aria-label={`Add binding to ${command.label}`}
                title="Add binding"
                onclick={() => startCapture(command.id, null)}
              >+</button>
            </div>
            <button
              type="button"
              class="reset-one"
              disabled={overrides[command.id] === undefined}
              onclick={() => resetOne(command.id)}
            >Reset</button>
          </article>
        {/each}
      </div>
      <footer class="keymap-status" role="status" aria-live="polite">
        <span>{status || `${Object.keys(overrides).length} customized commands`}</span>
        <kbd>Esc</kbd>
      </footer>
    </dialog>
  </div>
{/if}

<style>
  .keymap-overlay {
    position: fixed;
    z-index: 1001;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 12px;
  }

  .keymap-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgb(0 0 0 / 52%);
  }

  .keymap-panel {
    position: relative;
    display: flex;
    width: min(760px, 100%);
    max-height: min(690px, 90vh);
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #454545;
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 14px 40px rgb(0 0 0 / 60%);
    color: var(--text);
  }

  .keymap-heading {
    display: flex;
    min-height: 48px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 9px 6px 12px;
    border-bottom: 1px solid #3d3d3d;
  }

  h2 {
    margin: 0 0 3px;
    font-size: 12px;
  }

  .keymap-heading span,
  .command-copy code,
  .unbound,
  .keymap-status {
    color: var(--text-dim);
    font-size: 9px;
  }

  .heading-actions,
  .conflict-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 5px;
  }

  button {
    min-height: 25px;
    padding: 3px 7px;
    border: 1px solid #414141;
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: #727272;
    background: var(--bg-hover);
  }

  button:disabled {
    opacity: 0.38;
    cursor: default;
  }

  .close-button {
    width: 25px;
    padding: 0;
    font-size: 17px;
  }

  .keymap-list {
    min-height: 0;
    overflow: auto;
    padding: 4px 7px;
    scrollbar-color: #505050 #1b1b1b;
    scrollbar-width: thin;
  }

  .keymap-row {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(200px, 1.2fr) auto;
    align-items: center;
    gap: 9px;
    min-height: 43px;
    padding: 4px 5px;
    border-bottom: 1px solid #303030;
  }

  .command-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .command-label {
    overflow: hidden;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-copy code {
    overflow: hidden;
    font-family: var(--mono-font);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .binding-list {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .binding-button,
  .add-binding {
    min-width: 30px;
    min-height: 24px;
    padding: 2px 6px;
    font-family: var(--mono-font);
    font-size: 9px;
  }

  .binding-button.capturing {
    border-color: #a58a39;
    background: #3b321b;
    color: #fff0be;
  }

  .add-binding {
    width: 25px;
    padding: 0;
    color: var(--text-dim);
  }

  .reset-one {
    min-width: 47px;
    color: var(--text-dim);
    font-size: 9px;
  }

  .conflict-dialog {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 11px;
    border-bottom: 1px solid #6b5527;
    background: #302817;
    font-size: 10px;
  }

  .conflict-dialog p {
    margin: 3px 0 0;
    color: #d0bf8a;
  }

  .replace-button {
    border-color: #806b2d;
    background: #403619;
    color: #fff0be;
  }

  .keymap-status {
    display: flex;
    min-height: 29px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 10px;
    border-top: 1px solid #3b3b3b;
  }

  .keymap-status kbd {
    font-family: var(--mono-font);
  }

  @media (max-width: 560px) {
    .keymap-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 5px;
    }

    .binding-list {
      grid-column: 1 / -1;
      grid-row: 2;
      padding-bottom: 4px;
    }

    .reset-one {
      grid-column: 2;
      grid-row: 1;
    }
  }
</style>
