<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  interface Props extends Omit<HTMLInputAttributes, "type" | "checked" | "onchange"> {
    label: string;
    description?: string;
    checked: boolean;
    nested?: boolean;
    onchange: (checked: boolean) => void;
  }

  let { label, description, checked, nested = false, onchange, ...input }: Props = $props();
</script>

<label class="setting-row" class:is-nested={nested} class:is-compact={!description}>
  <span class="setting-copy">
    <span class="setting-title">{label}</span>
    {#if description}<span class="setting-description">{description}</span>{/if}
  </span>
  <input {...input} type="checkbox" {checked} onchange={(event) => onchange(event.currentTarget.checked)} />
</label>
