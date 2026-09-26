import manifest from "../../theme.json" with { type: "json" }

type Field = {
  key?: string
  type: string
  default?: unknown
  options?: { value: string }[]
  min?: number
  max?: number
}

export type ThemeConfig = {
  notice: string
  show_network: boolean
  show_resources: boolean
  show_renewal: boolean
  show_speed_chart: boolean
  show_latency_chart: boolean
}

const fields = (manifest.config as Field[]).filter((field): field is Field & { key: string; default: unknown } =>
  field.type !== "title" && typeof field.key === "string" && "default" in field,
)

function fits(field: Field, value: unknown): boolean {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        && value >= (field.min ?? -Infinity) && value <= (field.max ?? Infinity)
    case "select":
      return typeof value === "string" && Boolean(field.options?.some((option) => option.value === value))
    default:
      return typeof value === "string"
  }
}

function values(saved: Record<string, unknown>): ThemeConfig {
  return Object.fromEntries(fields.map((field) => [
    field.key,
    fits(field, saved[field.key]) ? saved[field.key] : field.default,
  ])) as ThemeConfig
}

export const defaultThemeConfig = values({})

/**
 * Theme settings are public display preferences stored by the hub. An older hub,
 * a closed public page or a network failure must all render the manifest defaults.
 */
export async function loadThemeConfig(request: typeof fetch = fetch): Promise<ThemeConfig> {
  try {
    const response = await request(`/api/themes/${manifest.short}/config`)
    if (!response.ok) return defaultThemeConfig
    const saved: unknown = await response.json()
    return values(saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, unknown> : {})
  } catch {
    return defaultThemeConfig
  }
}
