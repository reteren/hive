<script lang="ts">
  import { formatMediaTime } from "./time";

  let { value = 0, className = "" }: { value?: number; className?: string } = $props();
</script>

<time class={`media-time ${className}`}>{formatMediaTime(value)}</time>

<style>
  .media-time {
    color: #bcbcbc;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
