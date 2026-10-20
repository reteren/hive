<script lang="ts">
  import { deriveThemeTokens, type ThemeColors } from "./colors";

  interface Props {
    name: string;
    colors: ThemeColors;
    active: boolean;
    label: string;
    badge?: string;
    onclick: () => void;
  }

  let { name, colors, active, label, badge, onclick }: Props = $props();

  // A small board drawn in the theme's own five colours: board + grid behind, base panels
  // (toolbar, dock, notes), icon glyphs, and the accent on the active tool and the selected note.
  const tokens = $derived(deriveThemeTokens(colors));
</script>

<button
  class="theme-card"
  class:active
  type="button"
  aria-label={label}
  aria-pressed={active}
  style:--p-board={colors.board}
  style:--p-grid={colors.grid}
  style:--p-base={colors.base}
  style:--p-raised={tokens["--bg-panel-raised"]}
  style:--p-accent={colors.accent}
  style:--p-icon={colors.icon}
  style:--p-text={tokens["--text"]}
  style:--p-dim={tokens["--text-dim"]}
  {onclick}
>
  <span class="theme-preview" aria-hidden="true">
    <span class="mock-topbar">
      <span class="mock-glyph"></span>
      <span class="mock-glyph"></span>
      <span class="mock-tool"></span>
      <span class="mock-glyph"></span>
      <span class="mock-spacer"></span>
      <span class="mock-glyph is-round"></span>
    </span>
    <span class="mock-dock">
      <span class="mock-glyph"></span>
      <span class="mock-glyph is-accent"></span>
      <span class="mock-glyph"></span>
    </span>
    <svg class="mock-links" viewBox="0 0 100 62.5" preserveAspectRatio="none">
      <path d="M45 30 C52 30 52 22 59 22" />
      <path d="M45 34 C54 34 54 46 63 46" />
    </svg>
    <span class="mock-note is-selected" style="left: 21%; top: 36%;">
      <span class="mock-line is-head"></span>
      <span class="mock-line"></span>
      <span class="mock-line is-short"></span>
    </span>
    <span class="mock-note" style="left: 60%; top: 26%;">
      <span class="mock-line is-head"></span>
      <span class="mock-line is-short"></span>
    </span>
    <span class="mock-note" style="left: 64%; top: 64%;">
      <span class="mock-line is-head"></span>
      <span class="mock-line is-short"></span>
    </span>
    {#if active}
      <span class="theme-check">
        <svg viewBox="0 0 16 16"><path d="M4 8.4l2.6 2.6L12 5.6" /></svg>
      </span>
    {/if}
  </span>
  <span class="theme-footer">
    <span class="theme-name">{name}</span>
    {#if badge}<span class="theme-badge">{badge}</span>{/if}
    <span class="theme-dots" aria-hidden="true">
      <span style:background={colors.base}></span>
      <span style:background={colors.accent}></span>
      <span style:background={colors.icon}></span>
      <span style:background={colors.board}></span>
      <span style:background={colors.grid}></span>
    </span>
  </span>
</button>

<style>
  .theme-card {
    display: grid;
    width: 100%;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--settings-line-strong);
    border-radius: 12px;
    background: var(--p-base);
    color: var(--p-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      translate 200ms var(--ease-out),
      box-shadow var(--motion-quick) ease-out,
      border-color var(--motion-quick) ease-out;
  }

  .theme-card:hover {
    translate: 0 -2px;
    box-shadow: 0 8px 22px rgb(0 0 0 / 28%);
  }

  .theme-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 8px 22px rgb(0 0 0 / 24%);
  }

  .theme-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  :global(html[data-reduce-motion="true"]) .theme-card:hover {
    translate: none;
  }

  .theme-preview {
    position: relative;
    display: block;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background-color: var(--p-board);
    background-image:
      linear-gradient(color-mix(in srgb, var(--p-grid) 13%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--p-grid) 13%, transparent) 1px, transparent 1px),
      linear-gradient(color-mix(in srgb, var(--p-grid) 6%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--p-grid) 6%, transparent) 1px, transparent 1px);
    background-position: -1px -1px;
    background-size: 40px 40px, 40px 40px, 10px 10px, 10px 10px;
  }

  .mock-topbar {
    position: absolute;
    top: 7%;
    left: 6%;
    right: 6%;
    display: flex;
    height: 13%;
    align-items: center;
    gap: 5px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--p-base);
    box-shadow: 0 1px 4px rgb(0 0 0 / 22%);
  }

  .mock-dock {
    position: absolute;
    top: 27%;
    left: 6%;
    display: grid;
    width: 9%;
    justify-items: center;
    align-content: center;
    gap: 5px;
    padding: 6px 0;
    border-radius: 5px;
    background: var(--p-base);
    box-shadow: 0 1px 4px rgb(0 0 0 / 22%);
  }

  .mock-glyph {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 2px;
    background: var(--p-icon);
    opacity: 0.85;
  }

  .mock-glyph.is-round { border-radius: 50%; }
  .mock-glyph.is-accent { background: var(--p-accent); opacity: 1; }
  .mock-spacer { flex: 1; }

  .mock-tool {
    width: 18px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 3px;
    background: var(--p-accent);
  }

  .mock-links {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: var(--p-icon);
    stroke-width: 0.7;
    opacity: 0.55;
  }

  .mock-note {
    position: absolute;
    display: grid;
    width: 24%;
    gap: 3px;
    padding: 5px 6px 6px;
    border: 1px solid color-mix(in srgb, var(--p-text) 12%, transparent);
    border-radius: 4px;
    background: var(--p-raised);
  }

  .mock-note.is-selected {
    width: 25%;
    border-color: var(--p-accent);
    box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--p-accent) 40%, transparent);
  }

  .mock-line {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--p-dim);
    opacity: 0.6;
  }

  .mock-line.is-head {
    width: 62%;
    height: 4px;
    background: var(--p-text);
    opacity: 0.9;
  }

  .mock-line.is-short { width: 70%; }

  .theme-check {
    position: absolute;
    right: 7px;
    bottom: 7px;
    display: grid;
    width: 20px;
    height: 20px;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 2px 6px rgb(0 0 0 / 35%);
  }

  .theme-check svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: var(--on-accent);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .theme-footer {
    display: flex;
    min-height: 38px;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-top: 1px solid color-mix(in srgb, var(--p-text) 10%, transparent);
  }

  .theme-name {
    overflow: hidden;
    font-size: 12.5px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .theme-badge {
    color: var(--p-dim);
    font-size: 10.5px;
  }

  .theme-dots {
    display: flex;
    margin-left: auto;
  }

  .theme-dots span {
    width: 11px;
    height: 11px;
    border: 1.5px solid var(--p-base);
    border-radius: 50%;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--p-text) 16%, transparent);
  }

  .theme-dots span + span { margin-left: -3px; }
</style>
