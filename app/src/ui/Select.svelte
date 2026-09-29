<script lang="ts">
  import { selectKeyboardAction } from "../time/selectLogic";

  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    id: string;
    ariaLabel: string;
    value: string;
    options: readonly SelectOption[];
    onchange: (value: string) => void;
    disabled?: boolean;
    title?: string;
    ondblclick?: (event: MouseEvent) => void;
  }

  let { id, ariaLabel, value, options, onchange, disabled = false, title, ondblclick }: Props = $props();
  let trigger = $state<HTMLButtonElement>();
  let popup = $state<HTMLDivElement>();
  let open = $state(false);
  let activeIndex = $state(0);
  let popupPosition = $state({ left: 0, top: 0, width: 0 });

  const popupId = $derived(`${id}-options`);
  const selectedOption = $derived(options.find((option) => option.value === value));

  function initialActiveIndex(): number {
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    if (selectedIndex >= 0) return selectedIndex;
    return options.findIndex((option) => !option.disabled);
  }

  function setPopupPosition(): void {
    const rect = trigger?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 150);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const roomBelow = window.innerHeight - rect.bottom;
    const menuHeight = Math.min(options.length * 27 + 4, 216);
    const top = roomBelow >= menuHeight || rect.top < menuHeight + 8
      ? rect.bottom + 3
      : rect.top - menuHeight - 3;
    popupPosition = { left, top, width };
  }

  function openPopup(): void {
    if (disabled || !popup || popup.matches(":popover-open")) return;
    setPopupPosition();
    activeIndex = initialActiveIndex();
    popup.showPopover();
  }

  function closePopup(): void {
    if (popup?.matches(":popover-open")) popup.hidePopover();
    open = false;
  }

  function handleToggle(event: ToggleEvent): void {
    open = event.newState === "open";
    if (open) activeIndex = initialActiveIndex();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (disabled) return;
    const action = selectKeyboardAction(event.key, open);
    if (action === "open") {
      event.preventDefault();
      openPopup();
    } else if (action === "down" || action === "up") {
      event.preventDefault();
      if (options.length > 0) {
        const delta = action === "down" ? 1 : -1;
        const start = activeIndex >= 0 ? activeIndex : delta > 0 ? -1 : 0;
        for (let offset = 1; offset <= options.length; offset += 1) {
          const index = (start + delta * offset + options.length * 2) % options.length;
          if (options[index].disabled) continue;
          activeIndex = index;
          break;
        }
      }
    } else if (action === "select") {
      event.preventDefault();
      const active = options[activeIndex];
      if (active && !active.disabled) choose(active.value);
    } else if (action === "close") {
      event.preventDefault();
      closePopup();
      trigger?.focus();
    }
  }

  function choose(nextValue: string): void {
    if (disabled || options.find((option) => option.value === nextValue)?.disabled) return;
    if (nextValue !== value) onchange(nextValue);
    closePopup();
    trigger?.focus();
  }
</script>

<button
  bind:this={trigger}
  id={id}
  class="app-select-trigger"
  data-selection-ignore
  type="button"
  disabled={disabled}
  {title}
  role="combobox"
  aria-label={ariaLabel}
  aria-haspopup="listbox"
  aria-activedescendant={open && activeIndex >= 0 ? `${popupId}-option-${activeIndex}` : undefined}
  aria-controls={popupId}
  aria-expanded={open}
  popovertarget={popupId}
  popovertargetaction="toggle"
  onpointerdown={setPopupPosition}
  onkeydown={handleKeydown}
  ondblclick={ondblclick}
>
  <span class="app-select-value">{selectedOption?.label ?? "Select…"}</span>
  <span class="app-select-arrow" aria-hidden="true"></span>
</button>

<div
  bind:this={popup}
  id={popupId}
  class="app-select-popup"
  data-selection-ignore
  popover="auto"
  role="listbox"
  tabindex="-1"
  aria-label={ariaLabel}
  style:left={`${popupPosition.left}px`}
  style:top={`${popupPosition.top}px`}
  style:width={`${popupPosition.width}px`}
  ontoggle={handleToggle}
  onkeydown={handleKeydown}
>
  {#each options as option, index (option.value)}
    <button
      id={`${popupId}-option-${index}`}
      type="button"
      class="app-select-option"
      class:active={index === activeIndex}
      class:selected={option.value === value}
      role="option"
      aria-selected={option.value === value}
      tabindex="-1"
      disabled={option.disabled}
      onpointermove={() => { if (!option.disabled) activeIndex = index; }}
      onclick={() => choose(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .app-select-trigger {
    display: flex;
    width: 100%;
    min-width: 0;
    height: 25px;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    padding: 0 7px;
    color: #e3e3e3;
    background: #282828;
    border: 1px solid #4b4b4b;
    border-radius: 4px;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .app-select-trigger:hover { background: #303030; }
  .app-select-trigger:focus-visible { outline: 1px solid #d6ad53; outline-offset: 1px; }
  .app-select-trigger:disabled { opacity: .55; cursor: default; }
  .app-select-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .app-select-arrow {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-right: 1.5px solid #c8c8c8;
    border-bottom: 1.5px solid #c8c8c8;
    transform: translateY(-2px) rotate(45deg);
  }

  .app-select-popup {
    position: fixed;
    inset: auto;
    max-height: min(216px, calc(100vh - 16px));
    overflow: auto;
    margin: 0;
    padding: 2px;
    color: #e3e3e3;
    background: #282828;
    border: 1px solid #4b4b4b;
    border-radius: 4px;
    box-shadow: 0 5px 16px rgb(0 0 0 / 42%);
  }

  .app-select-popup:popover-open { display: grid; }
  .app-select-option {
    min-height: 23px;
    padding: 3px 6px;
    color: #d5d5d5;
    background: transparent;
    border: 0;
    border-radius: 2px;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .app-select-option:hover, .app-select-option.active { background: #393939; }
  .app-select-option.selected { color: #edc35e; }
  .app-select-option.selected.active { background: #413923; }
</style>
