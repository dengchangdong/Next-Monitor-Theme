import { createTimeoutSignal, delay, runConcurrent } from "./async.ts"

export type ConnectivityRegionId = "jp" | "us" | "global"
export type ConnectivityState = "idle" | "running" | "success" | "error"
export type ConnectivityLatencyLevel = "fast" | "normal" | "slow" | "timeout" | "pending"

export type ConnectivityRegion = { id: ConnectivityRegionId; label: string; country?: string }
export type ConnectivityTarget = { id: string; name: string; region: ConnectivityRegionId; url: string; fallbackUrl?: string }
export type ConnectivityResult = ConnectivityTarget & { state: ConnectivityState; samples: Array<number | null>; latency?: number }

export const CONNECTIVITY_PROBE_ROUNDS = 5
const TIMEOUT = 2_500

export const CONNECTIVITY_REGIONS: ConnectivityRegion[] = [
  { id: "jp", label: "日本", country: "JP" },
  { id: "us", label: "美国", country: "US" },
  { id: "global", label: "全球" },
]

const target = (region: ConnectivityRegionId, id: string, name: string, url: string, fallbackUrl?: string): ConnectivityTarget => ({ region, id, name, url, fallbackUrl })

export const CONNECTIVITY_TARGETS: ConnectivityTarget[] = [
  target("jp", "sony", "Sony", "https://www.sony.jp/favicon.ico", "https://www.sony.jp/"),
  target("jp", "nintendo", "任天堂", "https://www.nintendo.co.jp/favicon.ico", "https://www.nintendo.co.jp/"),
  target("jp", "yahoo-jp", "Yahoo! JP", "https://www.yahoo.co.jp/favicon.ico", "https://www.yahoo.co.jp/"),
  target("us", "apple", "Apple", "https://www.apple.com/favicon.ico", "https://www.apple.com/"),
  target("us", "google", "Google", "https://www.google.com/generate_204"),
  target("us", "github", "GitHub", "https://github.com/favicon.ico", "https://github.com/"),
  target("us", "cloudflare", "Cloudflare", "https://1.1.1.1/cdn-cgi/trace"),
  target("us", "chatgpt", "ChatGPT", "https://chatgpt.com/cdn-cgi/trace", "https://chatgpt.com/"),
  target("global", "tiktok", "TikTok", "https://www.tiktok.com/favicon.ico", "https://www.tiktok.com/"),
  target("global", "spotify", "Spotify", "https://open.spotify.com/favicon.ico", "https://open.spotify.com/"),
  target("global", "npm", "npm", "https://registry.npmjs.org/"),
  target("global", "wikipedia", "Wikipedia", "https://www.wikipedia.org/static/favicon/wikipedia.ico", "https://www.wikipedia.org/"),
]

export function createConnectivityResults() {
  return CONNECTIVITY_TARGETS.map<ConnectivityResult>((item) => ({ ...item, state: "idle", samples: [] }))
}

export function getConnectivityLatencyLevel(latency?: number | null): ConnectivityLatencyLevel {
  if (latency === null) return "timeout"
  if (latency === undefined) return "pending"
  if (latency < 100) return "fast"
  if (latency < 400) return "normal"
  return "slow"
}

async function probe(url: string, parentSignal: AbortSignal) {
  const request = createTimeoutSignal(parentSignal, TIMEOUT)
  const started = performance.now()
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: request.signal })
    return Math.round(performance.now() - started)
  } catch (error) {
    if (parentSignal.aborted) throw error
    return null
  } finally {
    request.dispose()
  }
}

async function checkTarget(item: ConnectivityTarget, signal: AbortSignal): Promise<ConnectivityResult> {
  const samples: Array<number | null> = []
  let url = item.url
  if (await probe(url, signal) === null && item.fallbackUrl) {
    if (await probe(item.fallbackUrl, signal) !== null) url = item.fallbackUrl
  }
  for (let round = 0; round < CONNECTIVITY_PROBE_ROUNDS; round += 1) {
    samples.push(await probe(url, signal))
    if (round < CONNECTIVITY_PROBE_ROUNDS - 1) await delay(100, signal)
  }
  const values = samples.filter((sample): sample is number => sample !== null).sort((left, right) => left - right)
  const latency = values[Math.floor(values.length / 2)]
  return { ...item, samples, latency, state: latency === undefined ? "error" : "success" }
}

export function checkConnectivityTargets(targets: ConnectivityTarget[], signal: AbortSignal, onResult: (result: ConnectivityResult) => void) {
  return runConcurrent(targets, 6, signal, (item) => checkTarget(item, signal), onResult)
}
