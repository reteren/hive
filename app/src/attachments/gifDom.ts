import { attachmentUrl } from "./service";
import {
  GIF_PLAYBACK_CHANGE_EVENT,
  gifPlayback,
  isGifStopped,
  shouldPlayGif,
  type GifPlaybackTarget,
} from "./gifPlayback.svelte";

export interface InlineGifDomOptions {
  file: string;
  alt: string;
  noteId: string;
  position: number;
}

/** Mount the CodeMirror GIF surface without mounting a Svelte component inside its widget. */
export function mountInlineGifDom(parent: HTMLElement, options: InlineGifDomOptions): () => void {
  const doc = parent.ownerDocument;
  const target: GifPlaybackTarget = { kind: "inline", noteId: options.noteId, position: options.position };
  const source = attachmentUrl(options.file);
  const surface = doc.createElement("div");
  surface.className = "cm-inline-gif-surface";
  surface.dataset.gifSurface = "";
  surface.dataset.gifTargetKind = target.kind;
  surface.dataset.gifNoteId = target.noteId;
  surface.dataset.gifPosition = String(target.position);
  surface.dataset.gifFile = options.file;

  const canvas = doc.createElement("canvas");
  canvas.className = "cm-inline-gif-picture";
  canvas.setAttribute("aria-hidden", "true");
  surface.append(canvas);
  parent.append(surface);

  let hovered = false;
  let stillReady = false;
  let failed = !source;
  let animation: HTMLImageElement | null = null;
  const imageLoader = doc.createElement("img");
  imageLoader.alt = options.alt;
  parent.setAttribute("aria-busy", "true");
  imageLoader.onload = () => {
    if (imageLoader.naturalWidth <= 0 || imageLoader.naturalHeight <= 0) {
      failed = true;
      parent.removeAttribute("aria-busy");
      sync();
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      failed = true;
      parent.removeAttribute("aria-busy");
      sync();
      return;
    }
    canvas.width = imageLoader.naturalWidth;
    canvas.height = imageLoader.naturalHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(imageLoader, 0, 0);
    stillReady = true;
    parent.removeAttribute("aria-busy");
    imageLoader.onload = null;
    imageLoader.onerror = null;
    imageLoader.removeAttribute("src");
    sync();
  };
  imageLoader.onerror = () => {
    failed = true;
    parent.removeAttribute("aria-busy");
    imageLoader.onload = null;
    imageLoader.onerror = null;
    sync();
  };

  if (source) imageLoader.src = source;
  else showMissing();

  const host = parent.closest<HTMLElement>("[data-gif-host-selected]");
  const sync = () => {
    const selected = host?.dataset.gifHostSelected === "true";
    const playing = shouldPlayGif({
      mode: gifPlayback.mode,
      stopped: isGifStopped(target),
      selected,
      hovered,
      hoverWhenSelected: true,
    });
    if (playing && !failed && source) {
      if (!animation) {
        animation = doc.createElement("img");
        animation.className = "cm-inline-gif-picture";
        animation.alt = options.alt;
        animation.draggable = false;
        animation.src = source;
        animation.onerror = () => {
          failed = true;
          animation?.remove();
          animation = null;
          showMissing();
        };
        surface.append(animation);
      }
    } else if (animation) {
      animation.onload = null;
      animation.onerror = null;
      animation.removeAttribute("src");
      animation.remove();
      animation = null;
    }
    canvas.hidden = !stillReady || Boolean(animation) || failed;
    surface.classList.toggle("gif-dom-loading", !stillReady && !failed);
    surface.classList.toggle("gif-dom-error", failed);
    if (failed && !surface.querySelector(".cm-inline-image-missing")) showMissing();
    if (!failed) surface.querySelector(".cm-inline-image-missing")?.remove();
  };

  const onEnter = () => { hovered = true; sync(); };
  const onLeave = () => { hovered = false; sync(); };
  const onPlaybackChange = () => sync();
  parent.addEventListener("pointerenter", onEnter);
  parent.addEventListener("pointerleave", onLeave);
  doc.defaultView?.addEventListener(GIF_PLAYBACK_CHANGE_EVENT, onPlaybackChange);
  const observer = host ? new MutationObserver(sync) : null;
  observer?.observe(host!, { attributes: true, attributeFilter: ["data-gif-host-selected"] });
  sync();

  return () => {
    parent.removeEventListener("pointerenter", onEnter);
    parent.removeEventListener("pointerleave", onLeave);
    doc.defaultView?.removeEventListener(GIF_PLAYBACK_CHANGE_EVENT, onPlaybackChange);
    observer?.disconnect();
    imageLoader.onload = null;
    imageLoader.onerror = null;
    imageLoader.removeAttribute("src");
    parent.removeAttribute("aria-busy");
    if (animation) {
      animation.onload = null;
      animation.onerror = null;
      animation.removeAttribute("src");
      animation.remove();
    }
    surface.remove();
  };

  function showMissing(): void {
    parent.removeAttribute("aria-busy");
    if (surface.querySelector(".cm-inline-image-missing")) return;
    const missing = doc.createElement("span");
    missing.className = "cm-inline-image-missing";
    missing.textContent = `File missing: ${options.alt || options.file}`;
    surface.append(missing);
  }
}
