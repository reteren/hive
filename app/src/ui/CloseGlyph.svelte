<script lang="ts">
  /* No props: the X inherits its colour from the button. */
</script>

<!-- The X inside dialog close buttons: same 12×12 drawing as the window close button; turns a quarter on hover. -->
<svg class="close-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>

<style>
  .close-glyph {
    display: block;
    width: 12px;
    height: 12px;
    margin: auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.4;
    transition: rotate 280ms var(--ease-spring);
  }

  :global(:hover) > .close-glyph,
  :global(:focus-visible) > .close-glyph {
    rotate: 90deg;
  }
</style>
