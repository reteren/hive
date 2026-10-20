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

<section class="settings-block" aria-labelledby="profile-settings-title" data-profile-settings>
  <div class="settings-block-header"><h3 id="profile-settings-title" class="settings-block-title">Profile</h3></div>
  <div class="settings-group">
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">Settings profile</span>
        <span class="setting-description">Appearance, drawing, keys, grid and zoom are kept per profile.</span>
      </span>
      <span class="settings-select">
        <Select id="settings-profile" ariaLabel="Settings profile" value={settingsProfiles.active} {options} onchange={changeProfile} />
      </span>
    </div>

    {#if editor}
      <form class="settings-inline-panel" data-profile-editor onsubmit={saveName}>
        <label for="settings-profile-name">{editor.kind === "create" ? "New profile from the current settings" : "Rename profile"}</label>
        <input
          id="settings-profile-name"
          class="settings-input is-text"
          bind:this={nameInput}
          bind:value={nameDraft}
          maxlength={MAX_PROFILE_NAME_LENGTH}
          autocomplete="off"
          required
          aria-label="Profile name"
          onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelEdit(); } }}
        />
        <span class="setting-control">
          <button class="settings-button" type="button" onclick={cancelEdit}>Cancel</button>
          <button class="settings-button is-primary" type="submit">Save</button>
        </span>
      </form>
    {:else if confirmingDelete}
      <div class="settings-inline-panel is-danger" role="alertdialog" aria-label="Delete profile" data-profile-delete-confirm>
        <p>Delete “{activeProfile?.name}”? Its settings are lost.</p>
        <span class="setting-control">
          <button class="settings-button" type="button" onclick={() => (confirmingDelete = false)}>Cancel</button>
          <button class="settings-button is-danger is-solid" type="button" onclick={confirmDelete}>Delete</button>
        </span>
      </div>
    {:else}
      <div class="setting-row is-compact">
        <span class="setting-description">{settingsProfiles.list.length} of {MAX_PROFILES} profiles</span>
        <span class="setting-control">
          <button class="settings-button" type="button" data-new-profile disabled={atLimit} title={atLimit ? `Up to ${MAX_PROFILES} profiles` : undefined} onclick={() => beginEdit({ kind: "create" })}>New profile…</button>
          <button class="settings-button" type="button" data-rename-profile onclick={() => beginEdit({ kind: "rename", id: settingsProfiles.active })}>Rename…</button>
          <button class="settings-button is-danger" type="button" data-delete-profile disabled={settingsProfiles.list.length <= 1} onclick={() => { editor = null; confirmingDelete = true; }}>Delete</button>
        </span>
      </div>
    {/if}
  </div>
</section>
