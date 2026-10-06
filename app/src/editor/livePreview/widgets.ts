import { Transaction } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";

export class PreviewTextWidget extends WidgetType {
  constructor(readonly text: string, readonly className: string) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof PreviewTextWidget && widget.text === this.text && widget.className === this.className;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = this.className;
    element.textContent = this.text;
    return element;
  }
}

export class PreviewRuleWidget extends WidgetType {
  eq(widget: WidgetType): boolean {
    return widget instanceof PreviewRuleWidget;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-hive-preview-hr";
    element.setAttribute("role", "separator");
    return element;
  }
}

export class PreviewCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof PreviewCheckboxWidget && widget.checked === this.checked && widget.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = `cm-hive-preview-checkbox${this.checked ? " is-checked" : ""}`;
    element.setAttribute("role", "checkbox");
    element.setAttribute("aria-checked", String(this.checked));
    element.setAttribute("aria-label", this.checked ? "Completed" : "Incomplete");
    element.tabIndex = -1;
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = view.state.doc.sliceString(this.from, this.from + 3);
      if (!/^\[[ xX]\]$/u.test(current)) return;
      const checked = /^\[[xX]\]$/u.test(current);
      view.dispatch({
        changes: { from: this.from, to: this.from + 3, insert: checked ? "[ ]" : "[x]" },
        annotations: Transaction.userEvent.of("input.livePreviewCheckbox"),
      });
    });
    return element;
  }
}
