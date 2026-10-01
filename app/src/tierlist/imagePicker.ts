export async function addTierlistImagesFromPicker(
  rowId: string,
  pickFiles: () => Promise<string[]>,
  importPaths: (rowId: string, paths: string[]) => Promise<void>,
): Promise<void> {
  const paths = await pickFiles();
  if (paths.length > 0) await importPaths(rowId, paths);
}
