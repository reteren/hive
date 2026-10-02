<script lang="ts">
  import { formatMediaTime } from "./time";

  let { seconds }: { seconds: number } = $props();
</script>

<time class="media-time">{formatMediaTime(seconds)}</time>

<style>
  .media-time {
    color: #e8e8e8;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
  }
</style>
