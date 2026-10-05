const RENDER_WAIT_MS = 1_500;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForTaskOrDeadline(task: Promise<void>, deadline: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
    function finish(): void {
      clearTimeout(timer);
      resolve();
    }
    void task.then(finish, finish);
  });
}

function waitForPdfPages(deadline: number): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      const loading = [...document.querySelectorAll<HTMLElement>(".board .pdf-message[role='status']")]
        .some((message) => /^Loading\b/u.test(message.textContent?.trim() ?? ""));
      if (!loading || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(check, Math.min(40, Math.max(0, deadline - Date.now())));
    };
    check();
  });
}

/** Give the fitted board two paint opportunities, then wait briefly for visible media to decode. */
export async function waitForBoardRender(): Promise<void> {
  const deadline = Date.now() + RENDER_WAIT_MS;
  await waitForTaskOrDeadline(nextFrame().then(() => nextFrame()), deadline);
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;

  const board = document.querySelector<HTMLElement>(".board") ?? document.body;
  const imageDecodes = [...board.querySelectorAll<HTMLImageElement>("img")]
    .filter((image) => Boolean(image.currentSrc || image.src))
    .map((image) => image.decode().catch(() => undefined));
  const mediaSettled = Promise.all([Promise.all(imageDecodes), waitForPdfPages(deadline)]).then(() => undefined);
  await waitForTaskOrDeadline(mediaSettled, deadline);
}
