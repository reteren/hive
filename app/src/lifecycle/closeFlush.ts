import { getCurrentWindow } from "@tauri-apps/api/window";

type Flush = () => Promise<void>;

const flushers = new Map<string, Flush>();
const CLOSE_FLUSH_TIMEOUT_MS = 3_000;

let listenerInstalled: Promise<void> | null = null;
let closeInProgress = false;
let allowClose = false;

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
