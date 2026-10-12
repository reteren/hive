<script lang="ts">
  import { onMount } from "svelte";

  let { src, alt = "", class: className = "", onerror }: {
    src: string;
    alt?: string;
    class?: string;
    onerror?: () => void;
  } = $props();
  let image = $state<HTMLImageElement | null>(null);
  let nearViewport = $state(false);

  onMount(() => {
    if (!image || !("IntersectionObserver" in window)) { nearViewport = true; return; }
    const observer = new IntersectionObserver(([entry]) => { nearViewport = Boolean(entry?.isIntersecting); }, { rootMargin: "240px" });
    observer.observe(image);
    return () => observer.disconnect();
  });
</script>

<img bind:this={image} src={nearViewport ? src : undefined} {alt} class={className} onerror={onerror} loading="lazy" decoding="async" />
