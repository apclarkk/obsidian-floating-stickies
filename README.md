# Floating Stickies

An Obsidian plugin that turns popout windows into stickies that float above your other apps. A new sticky opens with today's daily note in its first tab and moves to the new day's note at midnight. Everything else in the window works like normal Obsidian.

Desktop only. Obsidian has to be running for the stickies to show.

## Install

```bash
npm install
npm run install-plugin
```

This builds the plugin and copies it into `~/Vaults/Personal Vault/.obsidian/plugins/floating-stickies`. To use another vault, set `OBSIDIAN_VAULT=/path/to/vault` first. Then turn on Floating Stickies under Settings, Community plugins.

## Use

Run "New sticky" from the command palette. Any other popout window can become a sticky with "Make this window a sticky".

Each sticky has four buttons at the right end of its tab bar:

- Main window brings the main Obsidian window to the front, restoring it if it's minimized or hidden.
- Properties opens a small popover for changing the values of the current note's existing properties. Keys with eight or fewer values in your vault show as chips; the rest get a text field with suggestions. It can't add or remove properties.
- Pin keeps the window above other windows. Click it again to let the window stack normally.
- Roll up shrinks the window to its tab bar.

A global shortcut shows or hides all stickies from any app. Stickies come back where you left them when Obsidian restarts.

## Settings

- The global shortcut, recorded from a key press.
- Whether stickies appear on every Space and over full-screen apps.
- Fade: off, when not hovered, or when not focused, with one opacity slider. "When not focused" ignores the pointer and only turns opaque once you click into the sticky.
