import { getCurrentWindow } from "@tauri-apps/api/window";

type Flush = () => Promise<void>;

const flushers = new Map<string, Flush>();
const CLOSE_FLUSH_TIMEOUT_MS = 3_000;

let listenerInstalled: Promise<void> | null = null;
let closeInProgress = false;
let allowClose = false;
/**
 * The main window's close button only hides hive to the tray (R7.1); a real exit is requested from
 * the tray menu, which sets this flag first. A hide flushes pending saves but must not consume the
 * one-shot close state, otherwise the later real quit would skip its final flush.
 */
let quitRequested = true;
let trayMode = false;

/** Tray mode on: a close request only hides the window unless markQuitRequested(true) was called. */
export function enableTrayCloseMode(): void {
  trayMode = true;
  quitRequested = false;
}

export function markQuitRequested(requested: boolean): void {
  quitRequested = requested;
}

/** Register a flush to run before the app's single close request is resumed. */
export function registerCloseFlush(name: string, flush: Flush): () => void {
  flushers.set(name, flush);
  listenerInstalled ??= installCloseListener();
  return () => flushers.delete(name);
}

async function installCloseListener(): Promise<void> {
  try {
    await getCurrentWindow().onCloseRequested(handleCloseRequested);
  } catch (error) {
    console.error("Could not register the close-time project flush.", error);
    window.addEventListener("beforeunload", () => {
      void flushRegisteredTasks();
    });
  }
}

async function handleCloseRequested(event: { preventDefault(): void }): Promise<void> {
  if (trayMode && !quitRequested) {
    // Hide to tray: the Rust side prevents the close; just persist pending work.
    event.preventDefault();
    await flushRegisteredTasks();
    return;
  }
  if (allowClose) return;
  event.preventDefault();
  if (closeInProgress) return;

  closeInProgress = true;
  try {
    await flushRegisteredTasks();
    allowClose = true;
    await getCurrentWindow().close();
  } catch (error) {
    console.error("Could not resume the app close request after flushing.", error);
    closeInProgress = false;
  }
}

async function flushRegisteredTasks(): Promise<void> {
  const pending = Promise.all(
    [...flushers.entries()].map(async ([name, flush]) => {
      try {
        await flush();
      } catch (error) {
        console.error(`Could not flush ${name} before close.`, error);
      }
    }),
  );

  let timeoutId: number | undefined;
  await Promise.race([
    pending,
    new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(resolve, CLOSE_FLUSH_TIMEOUT_MS);
    }),
  ]);
  if (timeoutId !== undefined) window.clearTimeout(timeoutId);
}

/** Run the same registered save flushes used by the native close path before an explicit quit. */
export async function flushBeforeAppQuit(): Promise<void> {
  await flushRegisteredTasks();
}
