<script lang="ts">
  import { formatMediaTime } from "./time";

  let { seconds }: { seconds: number } = $props();
</script>

<time class="media-time">{formatMediaTime(seconds)}</time>

<style>
  .media-time {
    color: #bcbcbc;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
