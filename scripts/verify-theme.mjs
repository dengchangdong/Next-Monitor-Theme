import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const MiB = 1024 * 1024
const root = new URL("../", import.meta.url)
const parse = async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"))
const manifest = await parse("theme.json")
const packageJson = await parse("package.json")
const packageLock = await parse("package-lock.json")

for (const key of ["name", "short", "description", "version", "author", "url"]) {
  if (typeof manifest[key] !== "string") throw new Error(`theme.json.${key} must be a string`)
}
if (!manifest.name) throw new Error("theme.json.name must not be empty")
if (!/^[A-Za-z0-9_-]+$/.test(manifest.short)) throw new Error("theme.json.short contains unsupported characters")
if (packageJson.version !== manifest.version || packageLock.version !== manifest.version) {
  throw new Error("package.json, package-lock.json and theme.json versions must match")
}

if (manifest.config !== undefined) {
  if (!Array.isArray(manifest.config)) throw new Error("theme.json.config must be an array")
  const keys = new Set()
  const valueFits = (field, value) => {
    if (field.type === "boolean") return typeof value === "boolean"
    if (field.type === "number") return typeof value === "number" && Number.isFinite(value)
      && value >= (field.min ?? -Infinity) && value <= (field.max ?? Infinity)
    if (field.type === "select") return typeof value === "string" && field.options.some((option) => option.value === value)
    return typeof value === "string"
  }
  for (const [index, field] of manifest.config.entries()) {
    if (!field || typeof field !== "object" || Array.isArray(field)) throw new Error(`config[${index}] must be an object`)
    if (field.type === "title") {
      if (typeof field.label !== "string" || !field.label) throw new Error(`config[${index}] title needs a label`)
      continue
    }
    if (!new Set(["string", "text", "number", "boolean", "select"]).has(field.type)) {
      throw new Error(`config[${index}] has an unsupported type`)
    }
    if (typeof field.key !== "string" || !field.key || keys.has(field.key)) throw new Error(`config[${index}] needs a unique key`)
    keys.add(field.key)
    if (field.label !== undefined && typeof field.label !== "string") throw new Error(`config[${index}].label must be a string`)
    if (field.help !== undefined && typeof field.help !== "string") throw new Error(`config[${index}].help must be a string`)
    if (field.type === "select" && (!Array.isArray(field.options) || !field.options.length
      || field.options.some((option) => !option || typeof option.value !== "string" || !option.value
        || (option.label !== undefined && typeof option.label !== "string")))) {
      throw new Error(`config[${index}] needs valid select options`)
    }
    if (!valueFits(field, field.default)) throw new Error(`config[${index}].default does not fit its type`)
  }
}

const dist = new URL("dist/", root)
await stat(new URL("index.html", dist))
let files = 0
let directories = 1
let total = 0

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      directories++
      await walk(path)
    } else if (entry.isFile()) {
      files++
      const size = (await stat(path)).size
      if (size > 8 * MiB) throw new Error(`${path} exceeds the 8 MiB per-file limit`)
      total += size
    } else {
      throw new Error(`${path} is not a regular file or directory`)
    }
  }
}

await walk(fileURLToPath(dist))
for (const name of ["theme.json", "preview.png"]) total += (await stat(new URL(name, root))).size
if (total > 64 * MiB) throw new Error("expanded theme exceeds 64 MiB")
if (files + directories + 2 > 2000) throw new Error("theme contains more than 2000 files and directories")

console.log(`theme package verified: ${files + 2} files, ${(total / MiB).toFixed(2)} MiB expanded`)
