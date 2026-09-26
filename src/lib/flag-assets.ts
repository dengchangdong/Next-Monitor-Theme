const assets = import.meta.glob<string>("/node_modules/flag-icons/flags/4x3/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
})

const flagUrls = Object.fromEntries(
  Object.entries(assets).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -4), url]),
) as Record<string, string>

export function getFlagUrl(countryCode: string) {
  return flagUrls[countryCode] || flagUrls.cn
}
