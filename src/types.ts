export interface StickyRecord {
  /** Workspace id of the popout window. Obsidian keeps it across restarts. */
  windowId: string;
  /** Float above other apps' windows. */
  onTop: boolean;
  /** Rolled up to just the tab bar. */
  collapsed: boolean;
  expandedHeight?: number;
}

export interface StickiesSettings {
  /** Electron accelerator, e.g. "Control+Alt+S". Empty disables the global shortcut. */
  hotkey: string;
  allSpaces: boolean;
  /** off, faded unless hovered or focused, or faded unless focused. */
  fadeMode: "off" | "hover" | "focus";
  fadeOpacity: number;
  stickies: StickyRecord[];
}

export const DEFAULT_SETTINGS: StickiesSettings = {
  hotkey: "Control+Alt+S",
  allSpaces: true,
  fadeMode: "hover",
  fadeOpacity: 0.55,
  stickies: [],
};
