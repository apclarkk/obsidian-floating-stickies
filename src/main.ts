import { Notice, Plugin, WorkspaceLeaf, WorkspaceWindow, moment, setIcon, setTooltip } from "obsidian";
import { getOrCreateToday, isDailyNotePath, todayPath } from "./daily";
import { findBrowserWindow, getRemote } from "./electron";
import { togglePropertiesPopover } from "./properties";
import { StickiesSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type StickiesSettings, type StickyRecord } from "./types";

const DEFAULT_SIZE = { width: 380, height: 520 };

/**
 * A sticky is an ordinary Obsidian popout window with three extras: it can float above
 * other apps, it can roll up to its tab bar, and its first tab follows today's daily note.
 * Everything inside the window (tabs, links, editing) is plain Obsidian.
 */
export default class FloatingStickies extends Plugin {
  declare settings: StickiesSettings;
  private windows = new Map<string, any>(); // windowId -> BrowserWindow
  private listeners = new Map<string, AbortController>(); // windowId -> fade listeners
  private hovered = new Map<string, boolean>(); // windowId -> pointer is over the window
  private hotkeyRegistered: string | null = null;
  private quitting = false;
  private lastDay = moment().format("YYYY-MM-DD");

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new StickiesSettingTab(this.app, this));

    this.addCommand({ id: "new-sticky", name: "New sticky", callback: () => this.createSticky() });
    this.addCommand({ id: "toggle-all", name: "Show or hide all stickies", callback: () => this.toggleAll() });
    this.addCommand({
      id: "make-sticky",
      name: "Make this window a sticky",
      checkCallback: (check) => {
        const win = this.activeWindow();
        if (!win || this.recordFor(win)) return false;
        if (!check) this.adopt(win);
        return true;
      },
    });
    this.addCommand({
      id: "release-sticky",
      name: "Turn this sticky back into a normal window",
      checkCallback: (check) => this.withActiveSticky(check, (r) => this.release(r)),
    });
    this.addCommand({
      id: "toggle-collapse",
      name: "Roll up or unroll this sticky",
      checkCallback: (check) => this.withActiveSticky(check, (r) => this.setCollapsed(r, !r.collapsed)),
    });
    this.addCommand({
      id: "toggle-on-top",
      name: "Keep this sticky above other windows",
      checkCallback: (check) => this.withActiveSticky(check, (r) => this.setOnTop(r, !r.onTop)),
    });

    this.registerEvent(this.app.workspace.on("quit", () => (this.quitting = true)));
    this.registerDomEvent(window, "beforeunload", () => (this.quitting = true));

    this.app.workspace.onLayoutReady(async () => {
      await this.restoreStickies();
      this.registerEvent(this.app.workspace.on("layout-change", () => this.onLayoutChange()));
      this.registerInterval(window.setInterval(() => this.tick(), 30_000));
      this.registerHotkey();
    });
  }

  onunload() {
    this.unregisterHotkey();
    for (const rec of this.settings.stickies) this.strip(rec);
  }

  async loadSettings() {
    const data = (await this.loadData()) ?? {};
    // Earlier versions stored two exclusive fade toggles.
    if (!data.fadeMode && ("fadeEnabled" in data || "focusFadeEnabled" in data)) {
      data.fadeMode = data.focusFadeEnabled ? "focus" : data.fadeEnabled ? "hover" : "off";
    }
    for (const old of ["fadeEnabled", "focusFadeEnabled", "focusFadeOpacity", "linksToMain", "captureEnabled", "captureHeading", "captureFormat"]) delete data[old];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ---------- finding windows ----------

  private popouts(): WorkspaceWindow[] {
    const children: unknown[] = (this.app.workspace as any).floatingSplit?.children ?? [];
    return children.filter((c): c is WorkspaceWindow => c instanceof WorkspaceWindow);
  }

  private windowFor(rec: StickyRecord): WorkspaceWindow | null {
    return this.popouts().find((w) => (w as any).id === rec.windowId) ?? null;
  }

  private recordFor(win: WorkspaceWindow): StickyRecord | undefined {
    return this.settings.stickies.find((r) => r.windowId === (win as any).id);
  }

  private activeWindow(): WorkspaceWindow | null {
    const c = this.app.workspace.getMostRecentLeaf()?.getContainer();
    return c instanceof WorkspaceWindow ? c : null;
  }

  private withActiveSticky(check: boolean, fn: (r: StickyRecord) => void): boolean {
    const win = this.activeWindow();
    const rec = win && this.recordFor(win);
    if (!rec) return false;
    if (!check) fn(rec);
    return true;
  }

  private firstLeaf(win: WorkspaceWindow): WorkspaceLeaf | null {
    let first: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((l) => {
      if (!first && l.getContainer() === win) first = l;
    });
    return first;
  }

  // ---------- lifecycle ----------

  async createSticky() {
    const leaf = this.app.workspace.openPopoutLeaf({ size: DEFAULT_SIZE });
    await leaf.openFile(await getOrCreateToday(this.app));
    await this.adopt(leaf.getContainer() as WorkspaceWindow);
  }

  private async adopt(win: WorkspaceWindow) {
    const rec: StickyRecord = { windowId: (win as any).id, onTop: true, collapsed: false };
    this.settings.stickies.push(rec);
    await this.saveSettings();
    await this.attach(rec, win);
  }

  private async release(rec: StickyRecord) {
    if (rec.collapsed) this.setCollapsed(rec, false);
    this.strip(rec);
    this.settings.stickies.remove(rec);
    this.windows.delete(rec.windowId);
    await this.saveSettings();
  }

  /** Re-adopts stickies Obsidian restored from the last session, and reopens any it didn't. */
  private async restoreStickies() {
    // Records from v0.1 tracked a leaf; convert them to the leaf's window.
    this.settings.stickies = (this.settings.stickies as any[])
      .map((r) => {
        if (r.windowId) return r as StickyRecord;
        const c = r.leafId ? this.app.workspace.getLeafById(r.leafId)?.getContainer() : null;
        return c instanceof WorkspaceWindow ? { windowId: (c as any).id, onTop: true, collapsed: false } : null;
      })
      .filter((r): r is StickyRecord => !!r);

    for (const rec of this.settings.stickies) {
      let win = this.windowFor(rec);
      if (!win) {
        const leaf = this.app.workspace.openPopoutLeaf({ size: { width: DEFAULT_SIZE.width, height: rec.expandedHeight ?? DEFAULT_SIZE.height } });
        await leaf.openFile(await getOrCreateToday(this.app));
        win = leaf.getContainer() as WorkspaceWindow;
        rec.windowId = (win as any).id;
      } else {
        await this.followToday(win);
      }
      await this.attach(rec, win);
    }
    await this.saveSettings();
  }

  private async onLayoutChange() {
    if (this.quitting) return;
    const before = this.settings.stickies.length;
    this.settings.stickies = this.settings.stickies.filter((rec) => {
      const win = this.windowFor(rec);
      if (!win) this.windows.delete(rec.windowId);
      else this.addControls(rec, win);
      return !!win;
    });
    if (this.settings.stickies.length !== before) await this.saveSettings();
  }

  private async tick() {
    const day = moment().format("YYYY-MM-DD");
    if (day === this.lastDay) return;
    this.lastDay = day;
    for (const rec of this.settings.stickies) {
      const win = this.windowFor(rec);
      if (win) await this.followToday(win);
    }
  }

  /** If the window's first tab shows an older daily note (or nothing), switch it to today's. */
  private async followToday(win: WorkspaceWindow) {
    const leaf = this.firstLeaf(win);
    if (!leaf) return;
    const path: string | undefined = leaf.getViewState().state?.file as string | undefined;
    const today = await todayPath(this.app);
    if (path === today) return;
    if (path && !(await isDailyNotePath(this.app, path))) return;
    await leaf.openFile(await getOrCreateToday(this.app), { active: false });
  }

  // ---------- native window behavior ----------

  private async attach(rec: StickyRecord, win: WorkspaceWindow) {
    win.doc.body.addClass("fs-sticky-window");
    this.addControls(rec, win);

    const bw = await findBrowserWindow(win.win);
    if (!bw) {
      console.warn("Floating Stickies: no BrowserWindow found for popout", (win as any).id, "remote available:", !!getRemote());
      return void new Notice("Floating Stickies: couldn't reach this window, so it can't float or roll up.");
    }
    this.windows.set(rec.windowId, bw);
    bw.setMinimumSize(180, 28);
    this.applyWindowFlags(rec);

    // Listeners are tied to an AbortController so unloading the plugin removes them;
    // otherwise an old version's listeners keep running in the window after a reload.
    this.listeners.get(rec.windowId)?.abort();
    const ac = new AbortController();
    this.listeners.set(rec.windowId, ac);
    const opts = { signal: ac.signal };
    const setHover = (h: boolean) => {
      this.hovered.set(rec.windowId, h);
      this.applyFade(rec);
    };
    // Focus changes settle in the native window a moment after the DOM event.
    const later = () => win.win.setTimeout(() => this.applyFade(rec), 50);
    win.doc.documentElement.addEventListener("mouseenter", () => setHover(true), opts);
    win.doc.documentElement.addEventListener("mouseleave", () => setHover(false), opts);
    win.win.addEventListener("focus", later, opts);
    win.win.addEventListener("blur", later, opts);
    this.applyFade(rec);
    if (rec.collapsed) window.setTimeout(() => this.setCollapsed(rec, true), 300);
  }

  /** Undoes everything this plugin did to a window. */
  private strip(rec: StickyRecord) {
    this.listeners.get(rec.windowId)?.abort();
    this.listeners.delete(rec.windowId);
    this.hovered.delete(rec.windowId);
    const bw = this.windows.get(rec.windowId);
    try {
      if (bw && !bw.isDestroyed()) {
        bw.setAlwaysOnTop(false);
        bw.setVisibleOnAllWorkspaces(false);
        bw.setOpacity(1);
      }
    } catch {
      /* window already gone */
    }
    const win = this.windowFor(rec);
    win?.doc.body.removeClass("fs-sticky-window");
    win?.doc.querySelectorAll(".fs-window-controls, .fs-props-popover").forEach((n) => n.remove());
  }

  applyWindowFlags(rec: StickyRecord) {
    const bw = this.windows.get(rec.windowId);
    if (!bw || bw.isDestroyed()) return;
    const all = this.settings.allSpaces;
    // Spaces first: on macOS that call can reset the window level, so the level is set after it.
    bw.setVisibleOnAllWorkspaces(all, { visibleOnFullScreen: all, skipTransformProcessType: true });
    bw.setAlwaysOnTop(rec.onTop, "floating");
  }

  applyAllWindowFlags() {
    for (const rec of this.settings.stickies) this.applyWindowFlags(rec);
  }

  private async setOnTop(rec: StickyRecord, onTop: boolean) {
    rec.onTop = onTop;
    await this.saveSettings();
    this.applyWindowFlags(rec);
    const win = this.windowFor(rec);
    if (win) this.addControls(rec, win);
  }

  /**
   * "hover": faded unless the pointer is over the sticky or you're working in it.
   * "focus": faded unless you're working in it; hovering changes nothing.
   * Focus comes from the native window, since the popout's DOM focus isn't reliable.
   */
  private applyFade(rec: StickyRecord) {
    const bw = this.windows.get(rec.windowId);
    if (!bw || bw.isDestroyed()) return;
    const { fadeMode, fadeOpacity } = this.settings;
    const focused = bw.isFocused();
    const hovered = this.hovered.get(rec.windowId) ?? false;
    const faded = (fadeMode === "hover" && !hovered && !focused) || (fadeMode === "focus" && !focused);
    bw.setOpacity(faded ? fadeOpacity : 1);
  }

  refreshFade() {
    for (const rec of this.settings.stickies) this.applyFade(rec);
  }

  toggleAll() {
    const bws = this.settings.stickies.map((r) => this.windows.get(r.windowId)).filter((b) => b && !b.isDestroyed());
    if (bws.length === 0) return void this.createSticky();
    const anyVisible = bws.some((b) => b.isVisible());
    for (const b of bws) anyVisible ? b.hide() : b.showInactive();
  }

  private setCollapsed(rec: StickyRecord, collapsed: boolean) {
    const win = this.windowFor(rec);
    const bw = this.windows.get(rec.windowId);
    if (!win || !bw || bw.isDestroyed()) return;
    const [width, height] = bw.getContentSize();
    if (collapsed) {
      if (!win.doc.body.hasClass("fs-collapsed")) rec.expandedHeight = height;
      const bar = win.doc.querySelector(".workspace-tab-header-container");
      const bottom = bar ? Math.ceil(bar.getBoundingClientRect().bottom) : 40;
      win.doc.body.addClass("fs-collapsed");
      bw.setContentSize(width, bottom);
    } else {
      win.doc.body.removeClass("fs-collapsed");
      bw.setContentSize(width, rec.expandedHeight ?? DEFAULT_SIZE.height);
    }
    rec.collapsed = collapsed;
    this.saveSettings();
    this.addControls(rec, win);
  }

  // ---------- window controls in the tab bar ----------

  /** Puts pin and roll-up buttons at the right end of the window's tab bar. Safe to call repeatedly. */
  private addControls(rec: StickyRecord, win: WorkspaceWindow) {
    const bar = win.doc.querySelector(".workspace-tab-header-container");
    if (!bar) return;
    let box = bar.querySelector<HTMLElement>(":scope > .fs-window-controls");
    if (!box) {
      box = bar.createDiv("fs-window-controls");
      const main = box.createDiv({ cls: "clickable-icon fs-main" });
      setIcon(main, "app-window");
      setTooltip(main, "Show main Obsidian window");
      main.addEventListener("click", () => this.showMainWindow());
      const props = box.createDiv({ cls: "clickable-icon fs-props" });
      setIcon(props, "sliders-horizontal");
      setTooltip(props, "Properties");
      props.addEventListener("click", () => {
        if (rec.collapsed) this.setCollapsed(rec, false);
        togglePropertiesPopover(this.app, win, props);
      });
      box.createDiv({ cls: "clickable-icon fs-pin" }).addEventListener("click", () => this.setOnTop(rec, !rec.onTop));
      box.createDiv({ cls: "clickable-icon fs-roll" }).addEventListener("click", () => this.setCollapsed(rec, !rec.collapsed));
    }
    const pin = box.querySelector<HTMLElement>(".fs-pin")!;
    const roll = box.querySelector<HTMLElement>(".fs-roll")!;
    setIcon(pin, rec.onTop ? "pin" : "pin-off");
    pin.toggleClass("is-active", rec.onTop);
    setTooltip(pin, rec.onTop ? "Floating above other windows (click to stop)" : "Float above other windows");
    setIcon(roll, rec.collapsed ? "chevrons-up-down" : "chevrons-down-up");
    setTooltip(roll, rec.collapsed ? "Unroll" : "Roll up");
  }

  /** Restores the main vault window if it is minimized or hidden and brings it to the front. */
  async showMainWindow() {
    const remote = getRemote();
    const bw = remote?.getCurrentWindow?.() ?? (await findBrowserWindow(window));
    if (!bw) return void new Notice("Floating Stickies: couldn't find the main window.");
    if (bw.isMinimized()) bw.restore();
    if (!bw.isVisible()) bw.show();
    remote?.app?.focus?.({ steal: true });
    bw.focus();
  }

  // ---------- global shortcut ----------

  registerHotkey() {
    this.unregisterHotkey();
    const remote = getRemote();
    const acc = this.settings.hotkey;
    if (!remote || !acc) return;
    try {
      if (remote.globalShortcut.register(acc, () => this.toggleAll())) this.hotkeyRegistered = acc;
      else new Notice(`Floating Stickies: ${acc} is already taken by another app. Pick a different shortcut in settings.`);
    } catch (e) {
      new Notice(`Floating Stickies: couldn't register ${acc} (${(e as Error).message}).`);
    }
  }

  unregisterHotkey() {
    if (!this.hotkeyRegistered) return;
    try {
      getRemote()?.globalShortcut.unregister(this.hotkeyRegistered);
    } catch {
      /* ignore */
    }
    this.hotkeyRegistered = null;
  }
}
