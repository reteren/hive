export const overview = $state({ active: false });

export function setOverviewActive(active: boolean): void {
  overview.active = active;
  if (typeof document === "undefined") return;
  if (active) document.body.dataset.altOverview = "true";
  else {
    delete document.body.dataset.altOverview;
    delete document.body.dataset.altOverviewText;
  }
}
