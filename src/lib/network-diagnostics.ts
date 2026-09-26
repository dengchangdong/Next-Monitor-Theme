import { createTimeoutSignal, runConcurrent } from "./async.ts"

export type DiagnosticState = "idle" | "running" | "success" | "warning" | "error"
type SplitMethod = "trace" | "header" | "google-dns"

export type PublicIpResult = { ip: string; location?: string; source: string }
export type SplitTarget = {
  id: string
  label: string
  category: string
  url: string
  method: SplitMethod
  headerNames?: string[]
  fallbackUrl?: string
}
export type SplitResult = SplitTarget & {
  state: Exclude<DiagnosticState, "warning">
  ip?: string
  countryCode?: string
  location?: string
  ipPrefix?: number
  duration?: number
  message?: string
}
export type DnsResolver = { ip: string; provider?: string; location?: string }
export type DnsLeakResult = { resolvers: DnsResolver[]; complete: boolean }
export type WebRtcCandidate = { address: string; protocol?: string; type?: string; private: boolean }
export type WebRtcResult = {
  state: "success" | "warning"
  candidates: WebRtcCandidate[]
  publicAddresses: string[]
  message: string
}

const TIMEOUT = 6_000
const MAX_RESPONSE_BYTES = 64 * 1024
const CACHE_TTL = 5 * 60_000
const GEO_CACHE_TTL = 24 * 60 * 60_000
const STUN_URLS = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478", "stun:stun1.l.google.com:19302"]

let publicIpCache: { result: PublicIpResult; expiresAt: number } | null = null
const splitCache = new Map<string, { result: SplitResult; expiresAt: number }>()
const geographyCache = new Map<string, { result: { countryCode?: string; location?: string }; expiresAt: number }>()

const traceTarget = (id: string, label: string, category: string, domain: string, fallbackDomain?: string): SplitTarget => ({
  id,
  label,
  category,
  url: `https://${domain}/cdn-cgi/trace`,
  method: "trace",
  fallbackUrl: fallbackDomain ? `https://${fallbackDomain}/cdn-cgi/trace` : undefined,
})

const SPLIT_TARGETS: SplitTarget[] = [
  {
    id: "netease",
    label: "网易",
    category: "国内",
    url: "https://necaptcha.nosdn.127.net/ab7f4275c1744aa28e0a8f3a1c58c532.png",
    method: "header",
    headerNames: ["cdn-user-ip"],
  },
  {
    id: "google-location",
    label: "Google",
    category: "搜索与定位",
    url: "https://dns.google/resolve?name=o-o.myaddr.l.google.com&type=TXT",
    method: "google-dns",
  },
  traceTarget("cloudflare-cn", "Cloudflare 中国", "国内", "www.cloudflare-cn.com"),
  traceTarget("discord", "Discord", "社交与通讯", "gateway.discord.gg", "discord.com"),
  traceTarget("x", "X", "社交与通讯", "x.com"),
  traceTarget("claude", "Claude", "AI", "claude.ai"),
  traceTarget("chatgpt", "ChatGPT", "AI", "chatgpt.com"),
  traceTarget("openai", "OpenAI API", "AI", "api.openai.com"),
  traceTarget("perplexity", "Perplexity", "AI", "www.perplexity.ai"),
  traceTarget("coinbase", "Coinbase", "数字资产", "coinbase.com"),
  traceTarget("binance", "Binance", "数字资产", "www.binance.info"),
  traceTarget("cloudflare", "Cloudflare", "网络", "www.cloudflare.com", "speed.cloudflare.com"),
  traceTarget("npm", "npm Registry", "开发与 CDN", "registry.npmjs.org"),
  traceTarget("gitlab", "GitLab", "开发与 CDN", "gitlab.com"),
  traceTarget("unpkg", "unpkg", "开发与 CDN", "unpkg.com"),
  traceTarget("zoom", "Zoom", "办公与工具", "zoom.us"),
]

function normaliseAddress(value: string) {
  return value.trim().replace(/^\[|\]$/g, "").toLowerCase()
}

function isIpv4Address(value: string) {
  const parts = value.split(".").map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
}

function isIpv6Address(value: string) {
  if (!/^[0-9a-f:.]+$/i.test(value) || value.length > 45) return false
  const compressed = value.split("::")
  if (compressed.length > 2) return false
  let groups = 0
  for (const [sectionIndex, section] of compressed.entries()) {
    if (!section) continue
    const values = section.split(":")
    for (const [groupIndex, group] of values.entries()) {
      if (group.includes(".")) {
        if (sectionIndex !== compressed.length - 1 || groupIndex !== values.length - 1 || !isIpv4Address(group)) return false
        groups += 2
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) return false
        groups += 1
      }
    }
  }
  return compressed.length === 2 ? groups < 8 : groups === 8
}

export function isIpAddress(value: string) {
  const address = normaliseAddress(value)
  return address.includes(":") ? isIpv6Address(address) : isIpv4Address(address)
}

function findIp(value: string | null) {
  const candidates = value?.match(/(?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{0,4}:[0-9a-f:]+/gi) ?? []
  return candidates.map(normaliseAddress).find(isIpAddress)
}

function clean(value: unknown, maxLength = 120) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength) : undefined
}

async function readLimitedText(response: Response) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("响应数据过大")
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("响应数据过大")
  return text
}

async function fetchText(url: string, parentSignal: AbortSignal, init?: RequestInit) {
  const request = createTimeoutSignal(parentSignal, TIMEOUT)
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      ...init,
      signal: request.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return readLimitedText(response)
  } finally {
    request.dispose()
  }
}

function requestError(error: unknown) {
  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) return "请求超时"
  if (error instanceof Error && /abort|failed to fetch/i.test(error.message)) return "网络不可达或被浏览器拦截"
  return error instanceof Error ? error.message : "请求失败"
}

export function getCachedPublicIp() {
  return publicIpCache && publicIpCache.expiresAt > Date.now() ? publicIpCache.result : null
}

export async function checkPublicIp(signal: AbortSignal, force = false): Promise<PublicIpResult> {
  const cached = getCachedPublicIp()
  if (!force && cached) return cached
  try {
    const data = JSON.parse(await fetchText("https://ipwho.is/", signal)) as Record<string, unknown>
    const ip = typeof data.ip === "string" ? normaliseAddress(data.ip) : ""
    if (data.success === true && isIpAddress(ip)) {
      const location = [clean(data.country, 48), clean(data.region, 48), clean(data.city, 48)].filter(Boolean).join(" ")
      const result = { ip, location, source: "ipwho.is" }
      publicIpCache = { result, expiresAt: Date.now() + CACHE_TTL }
      return result
    }
  } catch (error) {
    if (signal.aborted) throw error
  }
  try {
    const text = await fetchText("https://my.ip.cn/", signal)
    const ip = findIp(text)
    if (ip) {
      const result = { ip, location: clean(text.match(/归属地[：:]\s*(.+)/)?.[1]), source: "IP.cn" }
      publicIpCache = { result, expiresAt: Date.now() + CACHE_TTL }
      return result
    }
  } catch (error) {
    if (signal.aborted) throw error
  }
  throw new Error("无法连接 IP 查询服务")
}

function parseTrace(text: string) {
  const fields = new Map(
    text.slice(0, 8192).split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)).filter((pair): pair is [string, string] => pair.length === 2),
  )
  const ip = normaliseAddress(fields.get("ip") ?? "")
  const countryCode = clean(fields.get("loc")?.toUpperCase(), 2)
  return { ip: isIpAddress(ip) ? ip : undefined, countryCode: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : undefined }
}

function parseGoogleDnsSubnet(text: string) {
  const data = JSON.parse(text.slice(0, 8192)) as { Status?: unknown; Answer?: unknown; edns_client_subnet?: unknown }
  if (data.Status !== 0) return {}
  const answers = Array.isArray(data.Answer)
    ? data.Answer.flatMap((answer) => clean((answer as { data?: unknown })?.data, 128) ?? [])
    : []
  const subnet = [...answers.filter((answer) => /edns0-client-subnet/i.test(answer)), clean(data.edns_client_subnet, 128)].find(Boolean)
  const ip = findIp(subnet ?? null)
  if (!ip) return {}
  const prefix = Number(subnet?.slice(subnet.indexOf(ip) + ip.length).match(/^\/(\d{1,3})/)?.[1])
  return Number.isInteger(prefix) ? { ip, ipPrefix: prefix } : { ip }
}

async function lookupGeography(ip: string, signal: AbortSignal) {
  const cached = geographyCache.get(ip)
  if (cached && cached.expiresAt > Date.now()) return cached.result
  try {
    const data = JSON.parse(await fetchText(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,region,city,connection`, signal)) as {
      success?: unknown
      country?: unknown
      country_code?: unknown
      region?: unknown
      city?: unknown
      connection?: { isp?: unknown; org?: unknown }
    }
    if (data.success !== true) return {}
    const countryCode = clean(data.country_code, 2)?.toUpperCase()
    const location = [clean(data.country, 48), clean(data.region, 48), clean(data.city, 48), clean(data.connection?.isp ?? data.connection?.org, 64)]
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
      .join(" ")
    const result = { countryCode: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : undefined, location: clean(location) }
    geographyCache.set(ip, { result, expiresAt: Date.now() + GEO_CACHE_TTL })
    return result
  } catch (error) {
    if (signal.aborted) throw error
    return {}
  }
}

async function requestSplitTarget(target: SplitTarget, signal: AbortSignal) {
  if (target.method === "google-dns") {
    const result = parseGoogleDnsSubnet(await fetchText(target.url, signal))
    return result.ip ? { ...result, ...(await lookupGeography(result.ip, signal)) } : result
  }
  if (target.method === "header") {
    const request = createTimeoutSignal(signal, TIMEOUT)
    try {
      const response = await fetch(target.url, { method: "HEAD", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: request.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const ip = target.headerNames?.map((name) => findIp(response.headers.get(name))).find(Boolean)
      return ip ? { ip, ...(await lookupGeography(ip, signal)) } : {}
    } finally {
      request.dispose()
    }
  }
  let lastError: unknown
  for (const url of [target.url, target.fallbackUrl].filter((value): value is string => Boolean(value))) {
    try {
      const trace = parseTrace(await fetchText(url, signal))
      if (trace.ip) return { ...trace, ...(await lookupGeography(trace.ip, signal)) }
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("响应中没有出口 IP")
}

export function getSplitTargets() {
  return SPLIT_TARGETS
}

export function getCachedSplitResults() {
  const now = Date.now()
  return [...splitCache.values()].filter((entry) => entry.expiresAt > now).map((entry) => entry.result)
}

export async function checkSplitTarget(target: SplitTarget, signal: AbortSignal): Promise<SplitResult> {
  const started = performance.now()
  try {
    const result = await requestSplitTarget(target, signal)
    if (!result.ip) throw new Error("响应中没有出口 IP")
    const completed: SplitResult = { ...target, ...result, state: "success", duration: Math.round(performance.now() - started) }
    splitCache.set(target.id, { result: completed, expiresAt: Date.now() + CACHE_TTL })
    return completed
  } catch (error) {
    if (signal.aborted) throw error
    return { ...target, state: "error", duration: Math.round(performance.now() - started), message: requestError(error) }
  }
}

export function checkSplitTargets(targets: SplitTarget[], signal: AbortSignal, onResult: (result: SplitResult) => void) {
  return runConcurrent(targets, 4, signal, (target) => checkSplitTarget(target, signal), onResult)
}

export async function checkDnsLeak(rounds: number, signal: AbortSignal): Promise<DnsLeakResult> {
  const resolvers = new Map<string, DnsResolver>()
  const safeRounds = Math.max(1, Math.min(8, Math.floor(rounds)))
  await runConcurrent(
    Array.from({ length: safeRounds }),
    2,
    signal,
    async () => {
      const token = crypto.randomUUID().replace(/-/g, "")
      try {
        const data = JSON.parse(await fetchText(`https://${token}.edns.ip-api.com/json`, signal)) as { dns?: { ip?: unknown; geo?: unknown } }
        const ip = typeof data.dns?.ip === "string" ? normaliseAddress(data.dns.ip) : ""
        if (!isIpAddress(ip)) return
        const parts = clean(data.dns?.geo)?.split(/\s+-\s+/) ?? []
        resolvers.set(ip, { ip, location: parts[0], provider: parts.slice(1).join(" - ") || undefined })
      } catch (error) {
        if (signal.aborted) throw error
      }
    },
  )
  return { resolvers: [...resolvers.values()].slice(0, 12), complete: true }
}

export function maskIpAddress(value: string) {
  if (value.includes(":")) return `${value.split(":").slice(0, 3).join(":")}:****:****`
  const parts = value.split(".")
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : value
}

function isPrivateAddress(value: string) {
  const address = normaliseAddress(value)
  if (address.endsWith(".local")) return true
  if (address === "::" || address === "::1" || /^(fe80|fc|fd)/.test(address)) return true
  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)
}

function parseCandidate(candidate: RTCIceCandidate): WebRtcCandidate | null {
  const fields = candidate.candidate.split(/\s+/)
  const address = normaliseAddress(candidate.address || fields[4] || "")
  if (!address || (!isIpAddress(address) && !address.endsWith(".local"))) return null
  const typeIndex = fields.indexOf("typ")
  return { address, protocol: candidate.protocol || fields[2]?.toLowerCase(), type: candidate.type || fields[typeIndex + 1], private: isPrivateAddress(address) }
}

export async function checkWebRtcLeak(baselineAddresses: string[], signal: AbortSignal): Promise<WebRtcResult> {
  if (!("RTCPeerConnection" in window)) throw new Error("当前浏览器不支持 WebRTC 检测")
  const peer = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] })
  const found = new Map<string, WebRtcCandidate>()
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish(new DOMException("检测已取消", "AbortError"))
      const timer = setTimeout(() => finish(), TIMEOUT)
      peer.onicecandidate = ({ candidate }) => {
        if (!candidate) return finish()
        const parsed = parseCandidate(candidate)
        if (parsed) found.set(`${parsed.address}-${parsed.protocol}-${parsed.type}`, parsed)
      }
      if (signal.aborted) abort()
      else signal.addEventListener("abort", abort, { once: true })
      peer.createDataChannel("diagnostics")
      void peer.createOffer().then((offer) => peer.setLocalDescription(offer)).catch((error: Error) => finish(error))
    })
  } finally {
    peer.close()
  }
  const candidates = [...found.values()]
  const publicAddresses = [...new Set(candidates.filter((candidate) => !candidate.private).map((candidate) => candidate.address))]
  const baseline = new Set(baselineAddresses.map(normaliseAddress).filter(Boolean))
  const exposesPrivate = candidates.some((candidate) => candidate.private && !candidate.address.endsWith(".local"))
  const differentExit = baseline.size > 0 && publicAddresses.some((address) => !baseline.has(address))
  return {
    state: differentExit || exposesPrivate ? "warning" : "success",
    candidates,
    publicAddresses,
    message: differentExit
      ? "WebRTC 的 UDP 出口与网页出口不同，请核对代理规则。"
      : exposesPrivate
        ? "浏览器暴露了局域网地址，请检查 WebRTC 隐私设置。"
        : publicAddresses.length
          ? "WebRTC 的公网 UDP 出口与网页出口一致。"
          : "未发现公网候选，WebRTC 可能已受到保护或当前网络阻止了 UDP。",
  }
}
