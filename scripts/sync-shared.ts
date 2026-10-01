// Copies the files in _shared/ into every template so each template folder stays standalone.
//
//   npm run sync            write the shared files into every template
//   npm run sync -- token   only the token template
//   npm run sync:check      exit 1 if any template has drifted from _shared (used in CI)
//
// .env.example is merged: the shared base is replaced, and everything from the
// "# --- <name> template ---" marker line down is kept as the template's own settings.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { listTemplates, NO_CONTRACTS, ROOT } from "./lib/templates.js"

/** _shared path -> path inside each template. */
export const SHARED_FILES: Record<string, string> = {
  "foundry.toml": "foundry.toml",
  "remappings.txt": "remappings.txt",
  "hardhat.config.base.ts": "hardhat.config.ts",
  "tsconfig.json": "tsconfig.json",
  // Stored without the dot so its rules do not apply to _shared/ itself.
  gitignore: ".gitignore",
  "scripts/lib/network.ts": "scripts/lib/network.ts",
  "scripts/lib/deployments.ts": "scripts/lib/deployments.ts",
  "scripts/lib/ignition-fees.ts": "scripts/lib/ignition-fees.ts",
  "frontend/wagmi.ts": "frontend/src/wagmi.ts",
  "frontend/ConnectButton.tsx": "frontend/src/components/ConnectButton.tsx",
  "frontend/TxStatus.tsx": "frontend/src/components/TxStatus.tsx",
  "frontend/theme.css": "frontend/src/theme.css",
  "frontend/vite-env.d.ts": "frontend/src/vite-env.d.ts",
  "frontend/vite.config.ts": "frontend/vite.config.ts",
  "frontend/tsconfig.json": "frontend/tsconfig.json",
}

/** Shared files that only make sense in a template with its own contracts. */
const CONTRACT_FILES = new Set([
  "foundry.toml",
  "remappings.txt",
  "hardhat.config.ts",
  "scripts/lib/deployments.ts",
  "scripts/lib/ignition-fees.ts",
])

const SHARED = path.join(ROOT, "_shared")
const ENV_BASE = ".env.example.base"

/** Normalise line endings so a Windows checkout with autocrlf does not count as drift. */
const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : undefined)

function mergedEnvExample(template: string): string {
  const base = read(path.join(SHARED, ENV_BASE))!.trimEnd()
  const current = read(path.join(ROOT, template, ".env.example")) ?? ""
  const marker = `# --- ${template} template ---`
  const index = current.indexOf(marker)
  const own = index === -1 ? `${marker}\n` : current.slice(index)
  return `${base}\n\n${own.trimEnd()}\n`
}

/** Returns the list of files that differ from _shared. Writes them unless `check` is set. */
export function syncTemplate(template: string, check: boolean): string[] {
  const wanted: Record<string, string> = {}
  for (const [from, to] of Object.entries(SHARED_FILES)) {
    if (NO_CONTRACTS.has(template) && CONTRACT_FILES.has(to)) continue
    wanted[to] = read(path.join(SHARED, from))!
  }
  wanted[".env.example"] = mergedEnvExample(template)

  const drifted: string[] = []
  for (const [relative, content] of Object.entries(wanted)) {
    const target = path.join(ROOT, template, relative)
    if (read(target) === content) continue
    drifted.push(`${template}/${relative}`)
    if (!check) {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
  }
  return drifted
}

function main() {
  const args = process.argv.slice(2)
  const check = args.includes("--check")
  const only = args.filter((arg) => !arg.startsWith("--"))
  const templates = only.length ? only : listTemplates()

  let drifted: string[] = []
  for (const template of templates) drifted = drifted.concat(syncTemplate(template, check))

  if (check) {
    if (drifted.length) {
      console.error("These files differ from _shared/:")
      for (const file of drifted) console.error(`  ${file}`)
      console.error("\nEdit the file in _shared/ (not in the template), then run `npm run sync`.")
      process.exitCode = 1
    } else {
      console.log(`Shared files are in sync across ${templates.length} template(s).`)
    }
  } else {
    for (const file of drifted) console.log(`updated ${file}`)
    console.log(drifted.length ? `Synced ${drifted.length} file(s).` : "Everything was already in sync.")
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main()
