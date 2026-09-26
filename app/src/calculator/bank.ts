import type { BankRow, CalculatorData } from "../model/nodeData";

export interface BankTotals {
  initial: number;
  spent: number;
  remaining: number;
}

/** Rows are a recalculated table, not a transaction log. */
export function bankTotals(data: CalculatorData): BankTotals | null {
  if (!data.bank) return null;
  const spent = data.rows.reduce((sum, row) => sum + row.amount, 0);
  return { initial: data.bank.initial, spent, remaining: data.bank.initial - spent };
}

const bankNumberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });

export function formatBankNumber(value: number): string {
  return Number.isFinite(value) ? bankNumberFormat.format(value) : "—";
}

export function parseBankAmount(value: string): number | null {
  if (value.trim() === "") return 0;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function updateBankRow(data: CalculatorData, id: string, patch: Partial<Pick<BankRow, "label" | "amount" | "sourceNoteId">>): CalculatorData {
  return {
    ...data,
    rows: data.rows.map((row) => row.id === id ? { ...row, ...patch } : row),
  };
}

export function addBankRow(data: CalculatorData, row: BankRow): CalculatorData {
  return data.rows.some((current) => current.id === row.id)
    ? data
    : { ...data, rows: [...data.rows, row] };
}

export function removeBankRow(data: CalculatorData, id: string): CalculatorData {
  return { ...data, rows: data.rows.filter((row) => row.id !== id) };
}
