import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

export const ROOT = path.resolve(import.meta.dirname, "..", "..")

/** Every top-level folder with a package.json, except the maintainer folders. */
export function listTemplates(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .filter((entry) => !["node_modules", "scripts"].includes(entry.name))
    .filter((entry) => existsSync(path.join(ROOT, entry.name, "package.json")))
    .map((entry) => entry.name)
    .sort()
}
