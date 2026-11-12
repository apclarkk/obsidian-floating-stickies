import { App, TFile, moment, normalizePath } from "obsidian";

interface DailyOptions {
  folder: string;
  format: string;
  template: string;
}

/** Reads the core Daily notes plugin settings, falling back to its config file. */
async function dailyOptions(app: App): Promise<DailyOptions> {
  let o = (app as any).internalPlugins?.getPluginById?.("daily-notes")?.instance?.options;
  if (!o) {
    try {
      o = JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/daily-notes.json`));
    } catch {
      o = {};
    }
  }
  return { folder: o.folder ?? "", format: o.format || "YYYY-MM-DD", template: o.template ?? "" };
}

export async function todayPath(app: App): Promise<string> {
  const o = await dailyOptions(app);
  const name = moment().format(o.format);
  return normalizePath(o.folder ? `${o.folder}/${name}.md` : `${name}.md`);
}

function applyTemplateVars(text: string, title: string): string {
  const now = moment();
  return text
    .replace(/{{\s*title\s*}}/gi, title)
    .replace(/{{\s*date(?::([^}]+))?\s*}}/gi, (_, f) => now.format(f?.trim() || "YYYY-MM-DD"))
    .replace(/{{\s*time(?::([^}]+))?\s*}}/gi, (_, f) => now.format(f?.trim() || "HH:mm"));
}

let pending: Promise<TFile> | null = null;

/** Returns today's daily note, creating it from the Daily notes template if needed. */
export function getOrCreateToday(app: App): Promise<TFile> {
  if (pending) return pending;
  pending = (async () => {
    const path = await todayPath(app);
    const existing = app.vault.getFileByPath(path);
    if (existing) return existing;

    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !app.vault.getFolderByPath(dir)) await app.vault.createFolder(dir);

    let content = "";
    const { template } = await dailyOptions(app);
    if (template) {
      const tPath = normalizePath(template.endsWith(".md") ? template : `${template}.md`);
      const tFile = app.vault.getFileByPath(tPath);
      if (tFile) content = applyTemplateVars(await app.vault.read(tFile), path.split("/").pop()!.replace(/\.md$/, ""));
    }
    return app.vault.create(path, content);
  })().finally(() => (pending = null));
  return pending;
}

/** True if the path is a daily note under the Daily notes folder and date format. */
export async function isDailyNotePath(app: App, path: string): Promise<boolean> {
  const o = await dailyOptions(app);
  const prefix = o.folder ? `${normalizePath(o.folder)}/` : "";
  if (!path.startsWith(prefix) || !path.endsWith(".md")) return false;
  return moment(path.slice(prefix.length, -3), o.format, true).isValid();
}
