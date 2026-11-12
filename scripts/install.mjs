// Copies the built plugin into the vault. Override the vault with OBSIDIAN_VAULT=/path/to/vault.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const vault = process.env.OBSIDIAN_VAULT ?? join(homedir(), "Vaults", "Personal Vault");
const dest = join(vault, ".obsidian", "plugins", "floating-stickies");
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, join(dest, f));
console.log(`Installed to ${dest}`);
