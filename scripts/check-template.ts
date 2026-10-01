// Checks that each template follows the repo rules. Run before opening a PR; CI runs it too.
//
//   npm run check            every template
//   npm run check -- token   one template
//
// It checks the README (disclaimer, footer, section order, dependency reasons, no em dashes),
// the package.json scripts, and scans source files for hard-coded addresses, RPC URLs,
// log-based frontend reads, secrets and imports that reach outside the template folder.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { listTemplates, ROOT } from "./lib/templates.js"
import { syncTemplate } from "./sync-shared.js"

const DISCLAIMER =
  "This is a learning template. It has not been audited. Use test funds only unless you know what you are doing."
const FOOTER = "Uzo Labs is an independent project and is not affiliated with or endorsed by BOT Chain."
const SECTIONS = [
  "What you'll build",
  "Prerequisites",
  "Quick start",
  "Verify",
  "How it works",
  "Make it yours",
  "Deploying to mainnet",
  "Troubleshooting",
  "Resources",
]
const REQUIRED_SCRIPTS = ["test", "test:hardhat", "deploy", "deploy:hardhat", "verify", "frontend"]

const SKIP_DIRS = new Set(["node_modules", "out", "cache", "artifacts", "broadcast", "dist", "deployments", ".git"])
const SOURCE_EXT = new Set([".ts", ".tsx", ".sol", ".html", ".css", ".json", ".md", ".toml", ".yml", ".txt"])
const GENERATED = new Set(["package-lock.json", "abi.ts"])
const URL_ALLOWED = new Set<string>()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && entry.name !== "deployments" && !entry.name.startsWith("chain-"))
        walk(path.join(dir, entry.name), out)
    } else if (SOURCE_EXT.has(path.extname(entry.name)) || entry.name.startsWith(".env")) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

function checkTemplate(template: string): string[] {
  const dir = path.join(ROOT, template)
  const problems: string[] = []
  const rel = (file: string) => path.relative(dir, file).split(path.sep).join("/")

  // README
  const readmePath = path.join(dir, "README.md")
  if (!existsSync(readmePath)) {
    problems.push("README.md is missing")
  } else {
    const readme = readFileSync(readmePath, "utf8").replace(/\r\n/g, "\n")
    const lines = readme.split("\n").filter((line) => line.trim() !== "")
    const plain = (line = "") => line.replace(/^[>\s*_]+|[\s*_]+$/g, "")
    if (plain(lines[0]) !== DISCLAIMER) problems.push(`README must start with: "${DISCLAIMER}"`)
    if (plain(lines.at(-1)) !== FOOTER) problems.push(`README must end with: "${FOOTER}"`)

    const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.replace(/^\d+\.\s*/, "").trim())
    let cursor = 0
    for (const section of SECTIONS) {
      const found = headings.indexOf(section, cursor)
      if (found === -1) problems.push(`README is missing the "## ${section}" section (or it is out of order)`)
      else cursor = found + 1
    }

    const troubleshooting = readme.split("## Troubleshooting")[1]?.split("\n## ")[0] ?? ""
    for (const topic of [/faucet/i, /wrong network/i, /USDT/, /verif/i, /eth_getLogs/]) {
      if (!topic.test(troubleshooting)) problems.push(`Troubleshooting should cover ${topic.source}`)
    }

    const pkgs = [path.join(dir, "package.json"), path.join(dir, "frontend", "package.json")].filter(existsSync)
    for (const pkgPath of pkgs) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (!readme.includes(`\`${dep}\``))
          problems.push(`README does not explain why \`${dep}\` is a dependency (${rel(pkgPath)})`)
      }
    }
  }

  // package.json scripts
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
  for (const script of REQUIRED_SCRIPTS) {
    if (!pkg.scripts?.[script]) problems.push(`package.json is missing the "${script}" script`)
  }
  if (!existsSync(path.join(dir, ".env.example"))) problems.push(".env.example is missing")

  // Source scan
  for (const file of walk(dir)) {
    const name = path.basename(file)
    const relative = rel(file)
    if (GENERATED.has(name)) continue
    if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
      if (!isIgnored(file)) problems.push(`${relative} holds secrets and must be git-ignored`)
      continue
    }
    const text = readFileSync(file, "utf8")
    const isReadme = name === "README.md"
    const isFrontend = relative.startsWith("frontend/src/")
    const isCode = /\.(ts|tsx|sol)$/.test(name)

    if (text.includes("—")) problems.push(`${relative} contains an em dash`)

    if (isCode) {
      // Named constants are fine (address(0), zeroAddress); literal addresses are not.
      if (/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.test(text)) problems.push(`${relative} hard-codes an address`)
      if (/https?:\/\/(rpc|scan)\./.test(text) && !URL_ALLOWED.has(name))
        problems.push(`${relative} hard-codes an RPC or explorer URL`)
      if (/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(text))
        problems.push(`${relative} contains a 32-byte hex value (possible private key)`)
      if (/\b(chainId|chain_id)\s*[:=]+\s*(677|968)\b|===?\s*(677|968)\b/.test(text))
        problems.push(`${relative} hard-codes a chain ID`)
    }
    if (!isReadme && /\b(mnemonic|seed phrase)\b\s*[:=]\s*["'`]\w+/i.test(text))
      problems.push(`${relative} looks like it contains a mnemonic`)
    if (name === ".env.example" && /^[ \t]*PRIVATE_KEY[ \t]*=[ \t]*\S+/m.test(text))
      problems.push(".env.example must leave PRIVATE_KEY empty")

    if (
      isFrontend &&
      /\b(useWatchContractEvent|watchContractEvent|watchEvent|getLogs|getContractEvents|getFilterLogs|createEventFilter|createContractEventFilter)\b|["']eth_getLogs["']/.test(
        text,
      )
    ) {
      problems.push(`${relative} reads logs; BOT Chain RPCs do not serve eth_getLogs, so poll reads instead`)
    }

    if (/\.(ts|tsx)$/.test(name)) {
      for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.[^"']*)["']/g)) {
        const target = path.resolve(path.dirname(file), match[1]!)
        if (!target.startsWith(dir + path.sep))
          problems.push(`${relative} imports "${match[1]}", which is outside the template`)
      }
    }
  }

  for (const file of syncTemplate(template, true)) problems.push(`${file} differs from _shared/ (run npm run sync)`)
  return problems
}

function isIgnored(file: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: ROOT, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const templates = only.length ? only : listTemplates()
let failed = 0
for (const template of templates) {
  if (!existsSync(path.join(ROOT, template)) || !statSync(path.join(ROOT, template)).isDirectory()) {
    console.error(`No template folder named "${template}".`)
    failed++
    continue
  }
  const problems = checkTemplate(template)
  if (problems.length) {
    failed++
    console.error(`\n${template}: ${problems.length} problem(s)`)
    for (const problem of problems) console.error(`  - ${problem}`)
  } else {
    console.log(`${template}: ok`)
  }
}
process.exitCode = failed ? 1 : 0
