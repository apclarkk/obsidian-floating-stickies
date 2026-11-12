import { App, ButtonComponent, PluginSettingTab, Setting } from "obsidian";
import { prettyAccelerator, toAccelerator } from "./electron";
import type FloatingStickies from "./main";

export class StickiesSettingTab extends PluginSettingTab {
  private stopRecording: (() => void) | null = null;

  constructor(app: App, private plugin: FloatingStickies) {
    super(app, plugin);
  }

  hide() {
    this.stopRecording?.();
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName("Window").setHeading();

    const hotkey = new Setting(containerEl)
      .setName("Show or hide all stickies")
      .setDesc(`Global shortcut that works from any app. Current: ${prettyAccelerator(s.hotkey)}`);
    hotkey.addButton((b) => b.setButtonText("Change").onClick(() => this.record(b, hotkey)));
    hotkey.addExtraButton((b) =>
      b.setIcon("x").setTooltip("Remove shortcut").onClick(async () => {
        s.hotkey = "";
        await save();
        this.plugin.registerHotkey();
        this.display();
      }),
    );

    new Setting(containerEl)
      .setName("Show on every Space")
      .setDesc("Stickies follow you across desktops and float over full-screen apps.")
      .addToggle((t) =>
        t.setValue(s.allSpaces).onChange(async (v) => {
          s.allSpaces = v;
          await save();
          this.plugin.applyAllWindowFlags();
        }),
      );

    new Setting(containerEl)
      .setName("Fade")
      .setDesc("When not hovered: see-through until you point at it or work in it. When not focused: see-through until you click into it; hovering does nothing.")
      .addDropdown((d) =>
        d
          .addOptions({ off: "Off", hover: "When not hovered", focus: "When not focused" })
          .setValue(s.fadeMode)
          .onChange(async (v) => {
            s.fadeMode = v as typeof s.fadeMode;
            await save();
            this.plugin.refreshFade();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Faded opacity")
      .setDisabled(s.fadeMode === "off")
      .addSlider((sl) =>
        sl
          .setLimits(0.2, 0.95, 0.05)
          .setValue(s.fadeOpacity)
          .setDisabled(s.fadeMode === "off")
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.fadeOpacity = v;
            await save();
            this.plugin.refreshFade();
          }),
      );
  }

  /** Listens for the next key combination and saves it as the global shortcut. */
  private record(button: ButtonComponent, setting: Setting) {
    this.stopRecording?.();
    this.plugin.unregisterHotkey(); // so pressing the current shortcut reaches us
    button.setButtonText("Press keys…").setCta();
    setting.setDesc("Press the new shortcut, with at least one of ⌘ ⌃ ⌥ ⇧. Esc cancels.");

    const doc = button.buttonEl.doc;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return finish();
      const acc = toAccelerator(e);
      if (!acc) return;
      this.plugin.settings.hotkey = acc;
      await this.plugin.saveSettings();
      finish();
    };
    const finish = () => {
      doc.removeEventListener("keydown", onKey, true);
      this.stopRecording = null;
      this.plugin.registerHotkey();
      this.display();
    };
    doc.addEventListener("keydown", onKey, true);
    this.stopRecording = finish;
  }
}
