<script lang="ts">
  import { tick } from "svelte";
  import Select from "../ui/Select.svelte";
  import { settingsProfiles } from "./profileState.svelte";
  import { MAX_PROFILE_NAME_LENGTH, MAX_PROFILES } from "./profiles";
  import {
    createSettingsProfile,
    deleteSettingsProfile,
    renameSettingsProfile,
    switchSettingsProfile,
  } from "./persistence.svelte";

  type Editor = { kind: "create" } | { kind: "rename"; id: string };

  let editor = $state<Editor | null>(null);
  let nameDraft = $state("");
  let nameInput = $state<HTMLInputElement | null>(null);
  let confirmingDelete = $state(false);

  const activeProfile = $derived(settingsProfiles.list.find((profile) => profile.id === settingsProfiles.active));
  const options = $derived(settingsProfiles.list.map((profile) => ({ value: profile.id, label: profile.name })));
  const atLimit = $derived(settingsProfiles.list.length >= MAX_PROFILES);

  async function beginEdit(next: Editor): Promise<void> {
    confirmingDelete = false;
    editor = next;
    nameDraft = next.kind === "rename" ? (activeProfile?.name ?? "") : "";
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }

  function saveName(event: SubmitEvent): void {
    event.preventDefault();
    if (!editor || !nameDraft.trim()) return;
    if (editor.kind === "create") createSettingsProfile(nameDraft);
    else renameSettingsProfile(editor.id, nameDraft);
    editor = null;
  }

  function cancelEdit(): void {
    editor = null;
    nameDraft = "";
  }

  function changeProfile(id: string): void {
    editor = null;
    confirmingDelete = false;
    switchSettingsProfile(id);
  }

  function confirmDelete(): void {
    deleteSettingsProfile(settingsProfiles.active);
    confirmingDelete = false;
  }
</script>

<section class="settings-section" aria-labelledby="profile-settings-title" data-profile-settings>
  <h2 id="profile-settings-title">Profiles</h2>
  <div class="setting-row">
    <span class="setting-copy">
      <span>Settings profile</span>
      <span class="setting-description">Appearance, drawing, keys, grid and zoom are kept per profile.</span>
    </span>
    <span class="profile-select">
      <Select id="settings-profile" ariaLabel="Settings profile" value={settingsProfiles.active} {options} onchange={changeProfile} />
    </span>
  </div>

  {#if editor}
    <form class="profile-editor" data-profile-editor onsubmit={saveName}>
      <label for="settings-profile-name">{editor.kind === "create" ? "New profile from the current settings" : "Rename profile"}</label>
      <div class="profile-editor-controls">
        <input
          id="settings-profile-name"
          bind:this={nameInput}
          bind:value={nameDraft}
          maxlength={MAX_PROFILE_NAME_LENGTH}
          autocomplete="off"
          required
          aria-label="Profile name"
          onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelEdit(); } }}
        />
        <button type="submit">Save</button>
        <button type="button" onclick={cancelEdit}>Cancel</button>
      </div>
    </form>
  {:else if confirmingDelete}
    <div class="profile-confirm" role="alertdialog" aria-label="Delete profile" data-profile-delete-confirm>
      <span>Delete “{activeProfile?.name}”? Its settings are lost.</span>
      <div class="profile-actions">
        <button type="button" class="danger" onclick={confirmDelete}>Delete</button>
        <button type="button" onclick={() => (confirmingDelete = false)}>Cancel</button>
      </div>
    </div>
  {:else}
    <div class="profile-actions">
      <button type="button" data-new-profile disabled={atLimit} title={atLimit ? `Up to ${MAX_PROFILES} profiles` : undefined} onclick={() => beginEdit({ kind: "create" })}>New profile…</button>
      <button type="button" data-rename-profile onclick={() => beginEdit({ kind: "rename", id: settingsProfiles.active })}>Rename…</button>
      <button type="button" data-delete-profile disabled={settingsProfiles.list.length <= 1} onclick={() => { editor = null; confirmingDelete = true; }}>Delete</button>
    </div>
  {/if}
</section>

<style>
  .settings-section { padding: 9px 0 9px; border-bottom: 1px solid #3b3b3b; }
  h2 { margin: 0 0 7px; color: var(--text-dim); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .setting-row { display: flex; min-height: 38px; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 2px; font-size: 11px; }
  .setting-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
  .setting-description { color: var(--text-dim); font-size: 9px; line-height: 1.35; }
  .profile-select { width: 150px; flex: 0 0 auto; }

  .profile-actions,
  .profile-editor-controls { display: flex; flex-wrap: wrap; gap: 4px; }
  .profile-actions { padding: 2px 2px 4px; }

  button {
    min-height: 24px;
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    background: var(--bg-panel-raised);
    font-size: 9px;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--bg-hover); }
  button:disabled { opacity: 0.45; cursor: default; }
  button:focus-visible,
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .danger { color: #ffb0a6; }

  .profile-editor,
  .profile-confirm {
    display: grid;
    gap: 5px;
    margin: 2px 2px 4px;
    padding: 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel-raised);
    font-size: 10px;
  }
  .profile-confirm .profile-actions { padding: 0; }
  .profile-editor button[type="submit"] { border-color: var(--accent); }

  .profile-editor-controls input {
    min-width: 0;
    flex: 1;
    height: 24px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    background: var(--bg-panel);
    font: inherit;
  }
</style>
