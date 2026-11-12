// Thin wrapper over Electron's remote module, which Obsidian exposes to desktop plugins.

export function getRemote(): any | null {
  const req = (window as any).require;
  for (const load of [() => req("electron").remote, () => req("@electron/remote")]) {
    try {
      const r = load();
      if (r?.BrowserWindow) return r;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Finds the native BrowserWindow behind a popout window. Popouts run in the main
 * renderer, so we tag the popout's title briefly and look for it, falling back to
 * matching the window's on-screen bounds.
 */
export async function findBrowserWindow(win: Window): Promise<any | null> {
  const remote = getRemote();
  if (!remote) return null;
  const token = `fs-${Math.random().toString(36).slice(2)}`;
  for (let i = 0; i < 40; i++) {
    const doc = win.document;
    if (doc?.readyState === "complete") {
      const original = doc.title;
      doc.title = token;
      await sleep(60);
      const all: any[] = remote.BrowserWindow.getAllWindows();
      let bw = all.find((w) => !w.isDestroyed() && w.getTitle() === token);
      if (doc.title === token) doc.title = original;
      if (!bw) {
        const near = (a: number, b: number) => Math.abs(a - b) <= 2;
        const byBounds = all.filter((w) => {
          if (w.isDestroyed()) return false;
          const b = w.getBounds();
          return near(b.x, win.screenX) && near(b.y, win.screenY) && near(b.width, win.outerWidth) && near(b.height, win.outerHeight);
        });
        if (byBounds.length === 1) bw = byBounds[0];
      }
      if (bw) return bw;
    }
    await sleep(100);
  }
  return null;
}

const CODE_KEYS: Record<string, string> = {
  Space: "Space", Enter: "Return", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`",
};

/** Converts a keydown into an Electron accelerator, or null if it isn't a usable shortcut yet. */
export function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey) mods.push("Command");
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else key = CODE_KEYS[e.code] ?? null;
  if (!key) return null;
  if (mods.length === 0 && !/^F\d/.test(key)) return null;
  return [...mods, key].join("+");
}

const SYMBOLS: Record<string, string> = { Command: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧" };

export function prettyAccelerator(acc: string): string {
  if (!acc) return "None";
  return acc.split("+").map((p) => SYMBOLS[p] ?? p).join("");
}
