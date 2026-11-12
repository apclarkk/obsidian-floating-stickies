import { App, TFile, WorkspaceWindow, setIcon } from "obsidian";

/** Keys with this many distinct values or fewer get chips; more get a text field with suggestions. */
const MAX_CHIPS = 8;

type Scalar = string | number | boolean;

const TYPE_ICONS: Record<string, string> = {
  text: "text",
  number: "binary",
  checkbox: "check-square",
  date: "calendar",
  datetime: "clock",
  multitext: "list",
  tags: "tags",
  aliases: "forward",
};

function propertyType(app: App, key: string): string | undefined {
  const mtm = (app as any).metadataTypeManager;
  return mtm?.getPropertyInfo?.(key.toLowerCase())?.type ?? mtm?.properties?.[key.toLowerCase()]?.type;
}

/** Every distinct single value this key has across the vault's notes. */
function valuesInVault(app: App, key: string): Scalar[] {
  const seen = new Map<string, Scalar>();
  for (const f of app.vault.getMarkdownFiles()) {
    const v = app.metadataCache.getFileCache(f)?.frontmatter?.[key];
    for (const x of Array.isArray(v) ? v : [v]) {
      if (x === null || x === undefined || x === "" || typeof x === "object") continue;
      seen.set(String(x), x);
    }
  }
  return [...seen.values()].sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * Opens (or closes, if open) a small popover under `anchor` for changing the values of the
 * properties the window's current note already has. It never adds or removes properties.
 */
export function togglePropertiesPopover(app: App, win: WorkspaceWindow, anchor: HTMLElement) {
  const doc = win.doc;
  const existing = doc.body.querySelector<HTMLElement>(".fs-props-popover");
  if (existing) return void (existing as any).__close?.();

  const leaf = app.workspace.getMostRecentLeaf(win as any);
  const file = (leaf?.view as any)?.file;

  const pop = doc.body.createDiv("fs-props-popover");
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  pop.style.right = `${Math.max(8, Math.round(doc.documentElement.clientWidth - r.right))}px`;

  const head = pop.createDiv("fs-props-head");
  const status = head.createSpan({ cls: "fs-props-status", text: "Esc to close" });
  let flashTimer = 0;
  const flash = (text: string) => {
    status.setText(text);
    status.addClass("is-saved");
    win.win.clearTimeout(flashTimer);
    flashTimer = win.win.setTimeout(() => {
      status.setText("Esc to close");
      status.removeClass("is-saved");
    }, 1400);
  };

  const close = () => {
    doc.removeEventListener("mousedown", onDown, true);
    doc.removeEventListener("keydown", onKey, true);
    app.workspace.offref(leafRef);
    pop.remove();
  };
  (pop as any).__close = close;
  const onDown = (e: MouseEvent) => {
    const t = e.target as Node;
    if (!pop.contains(t) && !anchor.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  doc.addEventListener("mousedown", onDown, true);
  doc.addEventListener("keydown", onKey, true);
  const leafRef = app.workspace.on("active-leaf-change", close);

  if (!(file instanceof TFile) || file.extension !== "md") {
    pop.createDiv({ cls: "fs-props-empty", text: "Open a note to change its properties." });
    return;
  }
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const keys = Object.keys(fm).filter((k) => k !== "position");
  if (keys.length === 0) {
    pop.createDiv({ cls: "fs-props-empty", text: "This note has no properties." });
    return;
  }

  const save = async (key: string, value: Scalar) => {
    await app.fileManager.processFrontMatter(file, (front) => {
      front[key] = value;
    });
    flash(`${key} saved`);
  };

  for (const key of keys) {
    const current = fm[key];
    const type = propertyType(app, key);
    const row = pop.createDiv("fs-props-row");
    const keyEl = row.createDiv("fs-props-key");
    setIcon(keyEl.createSpan("fs-props-icon"), TYPE_ICONS[type ?? ""] ?? "text");
    keyEl.createSpan({ text: key });
    const cell = row.createDiv("fs-props-value");

    // Lists, dates, and nested values are shown but not edited here.
    if (Array.isArray(current) || type === "date" || type === "datetime" || (current && typeof current === "object")) {
      const text = Array.isArray(current) ? current.join(", ") : String(current ?? "");
      cell.createSpan({ cls: "fs-props-readonly", text, attr: { title: text } });
      continue;
    }

    if (type === "checkbox" || typeof current === "boolean") {
      const box = cell.createEl("input", { type: "checkbox" });
      box.checked = current === true;
      box.addEventListener("change", () => save(key, box.checked));
      continue;
    }

    const options = valuesInVault(app, key);
    if (current !== null && current !== undefined && current !== "" && !options.some((o) => String(o) === String(current))) options.push(current);

    if (options.length > 0 && options.length <= MAX_CHIPS) {
      const chips = cell.createDiv("fs-props-chips");
      for (const opt of options) {
        const chip = chips.createEl("button", { cls: "fs-props-chip", text: String(opt), attr: { title: String(opt) } });
        chip.toggleClass("is-active", String(opt) === String(current));
        chip.addEventListener("click", async () => {
          if (chip.hasClass("is-active")) return;
          chips.querySelectorAll(".is-active").forEach((c) => c.removeClass("is-active"));
          chip.addClass("is-active");
          await save(key, opt);
        });
      }
      continue;
    }

    const listId = `fs-props-${Math.random().toString(36).slice(2)}`;
    const input = cell.createEl("input", { type: "text", value: String(current ?? ""), attr: { list: listId } });
    const list = cell.createEl("datalist", { attr: { id: listId } });
    for (const opt of options.slice(0, 200)) list.createEl("option", { value: String(opt) });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      const raw = input.value.trim();
      const numeric = (type === "number" || typeof current === "number") && raw !== "" && !isNaN(Number(raw));
      await save(key, numeric ? Number(raw) : raw);
      input.blur();
    });
  }
}
