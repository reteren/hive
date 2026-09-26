import { board } from "../model/board.svelte";
import { execute, record } from "../history/history.svelte";
import { links, registerLinkLifecycle } from "../model/links.svelte";
import { ME_OBJECT_ID, type Link } from "../model/link";
import { newId } from "../model/note";
import { calculatorKey, type BankRow, type CalculatorData } from "../model/nodeData";
import { calculatorData, calculators, setCalculatorData } from "./calculators.svelte";
import { addBankRow, removeBankRow, updateBankRow } from "./bank";

export const bankFocus = $state({ calculatorId: null as string | null, rowId: null as string | null });

type LinkedRow = { key: string; rowId: string; created: boolean };
const rowsByLink = new Map<string, LinkedRow>();
const suppressedLinks = new Set<string>();
let labelSyncStarted = false;

function copyData(data: CalculatorData): CalculatorData {
  return {
    entries: data.entries.map((entry) => ({ ...entry })),
    bank: data.bank ? { ...data.bank } : null,
    rows: data.rows.map((row) => ({ ...row })),
  };
}

function changeData(name: string, label: string, next: CalculatorData): void {
  const before = copyData(calculatorData(name));
  const after = copyData(next);
  execute({
    label,
    target: name,
    do: () => setCalculatorData(name, copyData(after)),
    undo: () => setCalculatorData(name, copyData(before)),
  });
}

export function createBank(name: string, bankName: string, initial: number): boolean {
  const title = bankName.trim();
  if (!title || !Number.isFinite(initial) || calculatorData(name).bank) return false;
  const data = calculatorData(name);
  changeData(name, "Create bank", { ...data, bank: { name: title, initial }, rows: rowsForExistingLinks(name, data.rows) });
  return true;
}

export function removeBank(name: string): boolean {
  const data = calculatorData(name);
  if (!data.bank) return false;
  changeData(name, "Remove bank", { ...data, bank: null, rows: [] });
  return true;
}

export function addManualBankRow(name: string, label: string, amount: number): string | null {
  const title = label.trim();
  if (!calculatorData(name).bank || !title || !Number.isFinite(amount)) return null;
  const row: BankRow = { id: newId(), label: title, amount, sourceNoteId: null };
  changeData(name, "Add bank row", addBankRow(calculatorData(name), row));
  return row.id;
}

export function deleteBankRow(name: string, rowId: string): boolean {
  const data = calculatorData(name);
  if (!data.rows.some((row) => row.id === rowId)) return false;
  const key = calculatorKey(name);
  const linkIds = [...rowsByLink.entries()].filter(([, mapped]) => mapped.key === key && mapped.rowId === rowId).map(([id]) => id);
  for (const link of Object.values(links.byId)) {
    if (linkedInfo(link)?.key === key && data.rows.find((row) => row.id === rowId)?.sourceNoteId === link.from && !linkIds.includes(link.id)) {
      linkIds.push(link.id);
    }
  }
  const before = copyData(data);
  const after = removeBankRow(before, rowId);
  execute({
    label: "Delete bank row", target: name,
    do: () => { setCalculatorData(name, copyData(after)); linkIds.forEach((id) => suppressedLinks.add(id)); },
    undo: () => { setCalculatorData(name, copyData(before)); linkIds.forEach((id) => suppressedLinks.delete(id)); },
  });
  return true;
}

function patchLive(name: string, patch: (data: CalculatorData) => CalculatorData): void {
  setCalculatorData(name, patch(calculatorData(name)));
}

/** Live edits update mirrors immediately; blur records the whole field edit as one Undo step. */
export function previewBankName(name: string, value: string): void {
  patchLive(name, (data) => data.bank ? { ...data, bank: { ...data.bank, name: value } } : data);
}

export function previewBankInitial(name: string, value: number): void {
  if (!Number.isFinite(value)) return;
  patchLive(name, (data) => data.bank ? { ...data, bank: { ...data.bank, initial: value } } : data);
}

export function previewBankRowLabel(name: string, rowId: string, value: string): void {
  const row = calculatorData(name).rows.find((item) => item.id === rowId);
  if (!row || row.sourceNoteId) return;
  patchLive(name, (data) => updateBankRow(data, rowId, { label: value }));
}

export function previewBankRowAmount(name: string, rowId: string, value: number): void {
  if (!Number.isFinite(value)) return;
  patchLive(name, (data) => updateBankRow(data, rowId, { amount: value }));
}

function recordFieldEdit<T>(
  name: string, label: string, before: T, after: T,
  apply: (name: string, value: T) => void,
): void {
  if (before === after) return;
  record({ label, target: name, do: () => apply(name, after), undo: () => apply(name, before) });
}

export function commitBankName(name: string, before: string, after: string): void {
  if (!calculatorData(name).bank) return;
  const title = after.trim() || before;
  previewBankName(name, title);
  recordFieldEdit(name, "Rename bank", before, title, previewBankName);
}

export function commitBankInitial(name: string, before: number, after: number): void {
  if (!Number.isFinite(after) || !calculatorData(name).bank) return;
  previewBankInitial(name, after);
  recordFieldEdit(name, "Edit bank initial", before, after, previewBankInitial);
}

export function commitBankRowLabel(name: string, rowId: string, before: string, after: string): void {
  if (!calculatorData(name).rows.some((row) => row.id === rowId && !row.sourceNoteId)) return;
  const label = after.trim() || before;
  previewBankRowLabel(name, rowId, label);
  recordFieldEdit(name, "Rename bank row", before, label, (key, value) => previewBankRowLabel(key, rowId, value));
}

export function commitBankRowAmount(name: string, rowId: string, before: number, after: number): void {
  if (!Number.isFinite(after) || !calculatorData(name).rows.some((row) => row.id === rowId)) return;
  previewBankRowAmount(name, rowId, after);
  recordFieldEdit(name, "Edit bank amount", before, after, (key, value) => previewBankRowAmount(key, rowId, value));
}

function linkedInfo(link: Link): { key: string; calculatorName: string; sourceName: string } | null {
  const source = board.notes[link.from];
  const calculator = board.notes[link.to];
  if (link.kind !== "strong" || link.from === ME_OBJECT_ID || !source || source.type === "beacon" || calculator?.type !== "calculator") return null;
  return { key: calculatorKey(calculator.name), calculatorName: calculator.name, sourceName: source.name };
}

function rowsForExistingLinks(name: string, existing: readonly BankRow[]): BankRow[] {
  const rows = [...existing];
  const key = calculatorKey(name);
  for (const link of Object.values(links.byId)) {
    const info = linkedInfo(link);
    if (!info || info.key !== key || rows.some((row) => row.sourceNoteId === link.from)) continue;
    rows.push({ id: `bank-link:${link.id}`, label: info.sourceName, amount: 0, sourceNoteId: link.from });
  }
  return rows;
}

function restoredLink(link: Link): void {
  const info = linkedInfo(link);
  if (!info || suppressedLinks.has(link.id)) return;
  const data = calculatorData(info.calculatorName);
  const previous = rowsByLink.get(link.id);
  const row = data.rows.find((item) => item.id === previous?.rowId) ??
    data.rows.find((item) => item.sourceNoteId === link.from) ??
    data.rows.find((item) => item.id === `bank-link:${link.id}`);
  if (row) {
    rowsByLink.set(link.id, { key: info.key, rowId: row.id, created: previous?.created ?? false });
    if (row.sourceNoteId !== link.from || row.label !== info.sourceName) {
      setCalculatorData(info.calculatorName, updateBankRow(data, row.id, { sourceNoteId: link.from, label: info.sourceName }));
    }
    return;
  }
  const rowId = `bank-link:${link.id}`;
  const newRow: BankRow = { id: rowId, label: info.sourceName, amount: 0, sourceNoteId: link.from };
  rowsByLink.set(link.id, { key: info.key, rowId, created: true });
  setCalculatorData(info.calculatorName, addBankRow(data, newRow));
  bankFocus.calculatorId = link.to;
  bankFocus.rowId = rowId;
}

registerLinkLifecycle({ onRestored: restoredLink });

/** Called only by the Undo branch of a newly created board link. */
export function removeCreatedBankRowForLink(link: Link): void {
  const info = linkedInfo(link);
  const mapped = rowsByLink.get(link.id);
  if (!info || !mapped?.created || mapped.key !== info.key) return;
  if (Object.values(links.byId).some((other) => other.id !== link.id && other.from === link.from && linkedInfo(other)?.key === info.key)) return;
  const data = calculatorData(info.calculatorName);
  if (data.rows.some((row) => row.id === mapped.rowId)) setCalculatorData(info.calculatorName, removeBankRow(data, mapped.rowId));
}

/** Explicit unlink keeps the amount but turns the linked row into a manual row. */
export function detachBankRowForLink(link: Link): void {
  const info = linkedInfo(link);
  if (!info) return;
  if (Object.values(links.byId).some((other) => other.id !== link.id && other.from === link.from && linkedInfo(other)?.key === info.key)) return;
  const data = calculatorData(info.calculatorName);
  const rowId = rowsByLink.get(link.id)?.rowId ?? `bank-link:${link.id}`;
  const row = data.rows.find((item) => item.id === rowId || item.sourceNoteId === link.from);
  if (row?.sourceNoteId === link.from) setCalculatorData(info.calculatorName, updateBankRow(data, row.id, { sourceNoteId: null }));
}

/** Rename follows only while the strong link exists; deletion preserves the last name. */
export function syncBankRowLabels(): void {
  for (const [key, data] of Object.entries(calculators.byKey)) {
    let changed = false;
    const rows = data.rows.map((row) => {
      if (!row.sourceNoteId) return row;
      const source = board.notes[row.sourceNoteId];
      if (!source || source.name === row.label) return row;
      const linked = Object.values(links.byId).some((link) => link.from === source.id && linkedInfo(link)?.key === key);
      if (!linked) return row;
      changed = true;
      return { ...row, label: source.name };
    });
    if (changed) calculators.byKey[key] = { ...data, rows };
  }
}

export function startBankLabelSync(): void {
  if (labelSyncStarted) return;
  labelSyncStarted = true;
  $effect.root(() => { $effect(() => { syncBankRowLabels(); }); });
}
