/**
 * One cheap reactive signal for "some saved project data changed". Mutation helpers of every
 * persisted collection (links, zones, trash, archive, task log, calculators…) call
 * markProjectChanged() next to their own revision counter; autosave reads `projectChange.revision`
 * in an effect, so it wakes once per change without reading the data itself.
 */
export const projectChange = $state({ revision: 0 });

export function markProjectChanged(): void {
  projectChange.revision += 1;
}
