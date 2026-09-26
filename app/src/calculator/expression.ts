import type { CalcEntry } from "../model/nodeData";

export type ExpressionResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export interface RecomputedCalcEntry extends CalcEntry {
  value: number | null;
  error: string | null;
}

type Operator = "+" | "-" | "*" | "/" | "^" | "%";
type Token =
  | { kind: "number"; value: number }
  | { kind: "operator"; value: Operator }
  | { kind: "left-paren" }
  | { kind: "right-paren" }
  | { kind: "end" };

/** Evaluate a plain arithmetic expression without executing or compiling user input. */
export function evaluateExpression(expression: string): ExpressionResult {
  try {
    const tokens = tokenize(expression);
    if (tokens.length === 1) throw new Error("Enter an expression.");
    const value = new Parser(tokens).parse();
    if (!Number.isFinite(value)) throw new Error("The result is outside the numeric range.");
    return { ok: true, value: Object.is(value, -0) ? 0 : value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid expression.",
    };
  }
}

/** Re-evaluate every saved row independently so one bad expression cannot hide other results. */
export function recomputeCalculatorEntries(entries: readonly CalcEntry[]): RecomputedCalcEntry[] {
  return entries.map((entry) => {
    const result = evaluateExpression(entry.expression);
    return result.ok
      ? { ...entry, value: result.value, error: null }
      : { ...entry, value: null, error: result.error };
  });
}

/** Keep ordinary floating-point tails out of the compact result line. */
export function formatCalculatorResult(value: number): string {
  if (!Number.isFinite(value)) return "Error";
  const rounded = Number(value.toPrecision(12));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (isDigit(char) || char === "." || char === ",") {
      const start = index;
      let sawDigit = false;
      while (isDigit(source[index])) {
        sawDigit = true;
        index += 1;
      }
      if (source[index] === "." || source[index] === ",") {
        index += 1;
        while (isDigit(source[index])) {
          sawDigit = true;
          index += 1;
        }
      }
      if (!sawDigit) throw new Error("A decimal separator must be next to a digit.");
      const value = Number(source.slice(start, index).replace(",", "."));
      if (!Number.isFinite(value)) throw new Error("That number is too large.");
      tokens.push({ kind: "number", value });
      continue;
    }

    if (char === "(") {
      tokens.push({ kind: "left-paren" });
    } else if (char === ")") {
      tokens.push({ kind: "right-paren" });
    } else if (char === "+" || char === "-") {
      tokens.push({ kind: "operator", value: char });
    } else if (char === "−") {
      tokens.push({ kind: "operator", value: "-" });
    } else if (char === "*" || char === "/" || char === "^") {
      tokens.push({ kind: "operator", value: char });
    } else if (char === "×") {
      tokens.push({ kind: "operator", value: "*" });
    } else if (char === "÷") {
      tokens.push({ kind: "operator", value: "/" });
    } else if (char === "%") {
      tokens.push({ kind: "operator", value: "%" });
    } else {
      throw new Error(`Unexpected character “${char}”.`);
    }
    index += 1;
  }

  tokens.push({ kind: "end" });
  return tokens;
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number {
    const value = this.parseAdditive();
    if (this.current.kind !== "end") {
      if (this.current.kind === "right-paren") throw new Error("There is an extra closing parenthesis.");
      throw new Error("Unexpected value or operator.");
    }
    return value;
  }

  private get current(): Token {
    return this.tokens[this.index];
  }

  private advance(): Token {
    const token = this.current;
    this.index += 1;
    return token;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (true) {
      const operator = this.current;
      if (operator.kind !== "operator" || (operator.value !== "+" && operator.value !== "-")) break;
      this.advance();
      const right = this.parseMultiplicative();
      value = checked(operator.value === "+" ? value + right : value - right);
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (true) {
      const operator = this.current;
      if (operator.kind !== "operator" || (operator.value !== "*" && operator.value !== "/")) break;
      this.advance();
      const right = this.parseUnary();
      if (operator.value === "/" && right === 0) throw new Error("Cannot divide by zero.");
      value = checked(operator.value === "*" ? value * right : value / right);
    }
    return value;
  }

  private parseUnary(): number {
    const operator = this.current;
    if (operator.kind === "operator" && (operator.value === "+" || operator.value === "-")) {
      this.advance();
      const value = this.parseUnary();
      return checked(operator.value === "-" ? -value : value);
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const value = this.parsePostfix();
    const operator = this.current;
    if (operator.kind !== "operator" || operator.value !== "^") return value;
    this.advance();
    return checked(value ** this.parseUnary());
  }

  private parsePostfix(): number {
    let value = this.parsePrimary();
    while (this.current.kind === "operator" && this.current.value === "%") {
      this.advance();
      value = checked(value / 100);
    }
    return value;
  }

  private parsePrimary(): number {
    const current = this.current;
    if (current.kind === "number") {
      const token = this.advance();
      if (token.kind === "number") return token.value;
    }
    if (current.kind === "left-paren") {
      this.advance();
      const value = this.parseAdditive();
      const closing = this.current;
      if (closing.kind !== "right-paren") throw new Error("Missing a closing parenthesis.");
      this.advance();
      return value;
    }
    if (current.kind === "end") throw new Error("The expression is incomplete.");
    if (current.kind === "right-paren") throw new Error("There is an unexpected closing parenthesis.");
    throw new Error("Expected a number or an opening parenthesis.");
  }
}

function checked(value: number): number {
  if (!Number.isFinite(value)) throw new Error("The result is outside the numeric range.");
  return Object.is(value, -0) ? 0 : value;
}
