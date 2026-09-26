import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleX,
  Eye,
  EyeOff,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  ShieldEllipsis,
  Wifi,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { ServerFlag } from "@/components/ServerFlag"
import {
  CONNECTIVITY_PROBE_ROUNDS,
  CONNECTIVITY_REGIONS,
  CONNECTIVITY_TARGETS,
  checkConnectivityTargets,
  createConnectivityResults,
  getConnectivityLatencyLevel,
  type ConnectivityRegionId,
} from "@/lib/network-connectivity"
import {
  checkDnsLeak,
  checkPublicIp,
  checkSplitTargets,
  checkWebRtcLeak,
  getCachedPublicIp,
  getCachedSplitResults,
  getSplitTargets,
  maskIpAddress,
  type DiagnosticState,
  type DnsLeakResult,
  type PublicIpResult,
  type SplitResult,
  type WebRtcCandidate,
  type WebRtcResult,
} from "@/lib/network-diagnostics"
import { Link } from "@/lib/route"
import "@/styles/network-diagnostics.css"

type CheckState<T> = { state: DiagnosticState; result?: T; message?: string }
type Tab = "split" | "connectivity" | "leaks"

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "split", label: "分流检测", icon: RouteIcon },
  { id: "connectivity", label: "联通检测", icon: Wifi },
  { id: "leaks", label: "泄露检测", icon: ShieldEllipsis },
]

const STATUS_ICONS: Record<DiagnosticState, LucideIcon> = {
  idle: Globe2,
  running: LoaderCircle,
  success: Check,
  warning: AlertTriangle,
  error: CircleX,
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "AbortError") return "请求已取消"
  return error instanceof Error && error.message ? error.message : fallback
}

function StatusLabel({ state, children }: { state: DiagnosticState; children: ReactNode }) {
  const Icon = STATUS_ICONS[state]
  return <span className={`network-diagnostics__status network-diagnostics__status--${state}`} role="status"><Icon aria-hidden="true" />{children}</span>
}

function ActionButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className="network-diagnostics__button" disabled={disabled} onClick={onClick}>{children}</button>
}

function DiagnosticBlock({ title, description, status, actions, children, subsection = false }: {
  title: string
  description: string
  status: ReactNode
  actions: ReactNode
  children: ReactNode
  subsection?: boolean
}) {
  const id = `diagnostic-${title.replace(/\s+/g, "-")}`
  return (
    <section className={subsection ? "network-diagnostics__subsection" : "network-diagnostics__card"} aria-labelledby={id}>
      <header className="network-diagnostics__section-header">
        <div className="network-diagnostics__section-copy"><h2 id={id}>{title}</h2><p>{description}</p>{status}</div>
        <div className="network-diagnostics__section-actions">{actions}</div>
      </header>
      {children}
    </section>
  )
}

function EmptyResult({ children }: { children: ReactNode }) {
  return <div className="network-diagnostics__empty">{children}</div>
}

function CountryFlag({ countryCode }: { countryCode?: string }) {
  return countryCode && /^[A-Z]{2}$/i.test(countryCode)
    ? <ServerFlag code={countryCode} className="network-diagnostics__country-flag" />
    : <Globe2 className="network-diagnostics__country-placeholder" aria-hidden="true" />
}

function SiteMark({ label }: { label: string }) {
  return <span className="network-diagnostics__site-mark" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
}

function WebRtcStatus({ candidate, baseline }: { candidate: WebRtcCandidate; baseline: Set<string> }) {
  if (candidate.address.endsWith(".local")) return <StatusLabel state="success">地址已保护</StatusLabel>
  if (candidate.private) return <StatusLabel state="warning">可能泄露</StatusLabel>
  if (baseline.size && !baseline.has(candidate.address)) return <StatusLabel state="warning">出口不同</StatusLabel>
  return <StatusLabel state="success">正常</StatusLabel>
}

export default function NetworkDiagnostics() {
  const targets = useMemo(getSplitTargets, [])
  const controllers = useRef(new Set<AbortController>())
  const cachedPublicIp = useMemo(getCachedPublicIp, [])
  const cachedSplit = useMemo(() => new Map(getCachedSplitResults().map((result) => [result.id, result])), [])
  const [activeTab, setActiveTab] = useState<Tab>("split")
  const [maskIp, setMaskIp] = useState(true)
  const [publicIp, setPublicIp] = useState<CheckState<PublicIpResult>>(cachedPublicIp
    ? { state: "success", result: cachedPublicIp, message: "已使用 5 分钟内的查询结果" }
    : { state: "idle" })
  const [splitResults, setSplitResults] = useState<SplitResult[]>(targets.map((target) => cachedSplit.get(target.id) ?? { ...target, state: "idle" }))
  const [splitRunning, setSplitRunning] = useState(false)
  const [connectivityResults, setConnectivityResults] = useState(createConnectivityResults)
  const [connectivityRunning, setConnectivityRunning] = useState(false)
  const [dns, setDns] = useState<CheckState<DnsLeakResult>>({ state: "idle" })
  const [webRtc, setWebRtc] = useState<CheckState<WebRtcResult>>({ state: "idle" })

  async function runAbortable<T>(task: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      return await task(controller.signal)
    } finally {
      controllers.current.delete(controller)
    }
  }

  async function runPublicIp(force = false) {
    setPublicIp((current) => ({ ...current, state: "running", message: "正在查询网页出口" }))
    try {
      const result = await runAbortable((signal) => checkPublicIp(signal, force))
      setPublicIp({ state: "success", result, message: `查询来源：${result.source}` })
      return result
    } catch (error) {
      setPublicIp({ state: "error", message: errorMessage(error, "IP 查询失败") })
      return null
    }
  }

  useEffect(() => {
    if (!cachedPublicIp) void runPublicIp()
    const active = controllers.current
    return () => active.forEach((controller) => controller.abort())
    // The automatic lookup runs only on the route's first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runSplit() {
    if (splitRunning) return
    setSplitRunning(true)
    setSplitResults(targets.map((target) => ({ ...target, state: "running" })))
    try {
      await runAbortable((signal) => checkSplitTargets(targets, signal, (result) => {
        setSplitResults((current) => current.map((item) => item.id === result.id ? result : item))
      }))
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setSplitResults((current) => current.map((item) => item.state === "running" ? { ...item, state: "error", message: errorMessage(error, "检测失败") } : item))
      }
    } finally {
      setSplitRunning(false)
    }
  }

  async function runConnectivity(region?: ConnectivityRegionId) {
    if (connectivityRunning) return
    const selected = region ? CONNECTIVITY_TARGETS.filter((target) => target.region === region) : CONNECTIVITY_TARGETS
    const ids = new Set(selected.map((target) => target.id))
    setConnectivityRunning(true)
    setConnectivityResults((current) => current.map((result) => ids.has(result.id) ? { ...result, state: "running", samples: [] } : result))
    try {
      await runAbortable((signal) => checkConnectivityTargets(selected, signal, (result) => {
        setConnectivityResults((current) => current.map((item) => item.id === result.id ? result : item))
      }))
    } finally {
      setConnectivityRunning(false)
    }
  }

  async function runDns(rounds: number) {
    setDns({ state: "running", message: `正在执行 ${rounds} 次 DNS 探测` })
    try {
      const result = await runAbortable((signal) => checkDnsLeak(rounds, signal))
      setDns({ state: result.resolvers.length ? "success" : "warning", result, message: result.resolvers.length ? `发现 ${result.resolvers.length} 个解析器` : "未取得解析器信息" })
    } catch (error) {
      setDns({ state: "error", message: errorMessage(error, "DNS 检测失败") })
    }
  }

  async function runWebRtc() {
    setWebRtc({ state: "running", message: "正在检查 WebRTC UDP 出口" })
    const baseline = [publicIp.result?.ip, ...splitResults.flatMap((result) => result.state === "success" && result.ip && result.ipPrefix === undefined ? [result.ip] : [])]
      .filter((value): value is string => Boolean(value))
    try {
      const result = await runAbortable((signal) => checkWebRtcLeak(baseline, signal))
      setWebRtc({ state: result.state, result, message: result.message })
    } catch (error) {
      setWebRtc({ state: "error", message: errorMessage(error, "WebRTC 检测失败") })
    }
  }

  const splitDone = splitResults.filter((result) => ["success", "error"].includes(result.state))
  const splitSuccess = splitResults.filter((result) => result.state === "success" && result.ip)
  const splitExits = [...new Map(splitSuccess.map((result) => [result.ip, result])).values()]
  const splitState: DiagnosticState = splitRunning ? "running" : !splitDone.length ? "idle" : !splitSuccess.length ? "error" : splitExits.length > 1 ? "warning" : "success"
  const connectivityDone = connectivityResults.filter((result) => ["success", "error"].includes(result.state))
  const baseline = new Set([publicIp.result?.ip, ...splitSuccess.map((result) => result.ip)].filter((value): value is string => Boolean(value)))

  function tabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length
    if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length
    if (event.key === "Home") next = 0
    if (event.key === "End") next = TABS.length - 1
    if (next === undefined) return
    event.preventDefault()
    setActiveTab(TABS[next].id)
    document.getElementById(`diagnostic-tab-${TABS[next].id}`)?.focus()
  }

  return (
    <div className="network-diagnostics">
      <header className="network-diagnostics__intro">
        <Link href="/" className="network-diagnostics__back"><ArrowLeft aria-hidden="true" />返回节点状态</Link>
        <div className="network-diagnostics__heading">
          <span className="network-diagnostics__mark" aria-hidden="true"><RouteIcon /></span>
          <div><h1>网络与 IP 分流检测</h1><p>检查网页出口、网站分流、网络连通性、DNS 解析与 WebRTC UDP 路径。</p></div>
          <button type="button" className="network-diagnostics__mask" role="switch" aria-checked={maskIp} onClick={() => setMaskIp((current) => !current)}>
            {maskIp ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}<span>隐藏 IP</span>
          </button>
        </div>
        <aside className="network-diagnostics__privacy"><ShieldCheck aria-hidden="true" /><p>检测只在浏览器中执行，结果不会发送到主控端。进入页面后仅自动查询一次网页出口，其他项目按需运行。</p></aside>
      </header>

      <DiagnosticBlock
        title="我的 IP"
        description="查询当前网页连接使用的公网地址和归属地。"
        status={<StatusLabel state={publicIp.state}>{publicIp.state === "running" ? "正在查询" : publicIp.message || "进入页面后自动查询一次"}</StatusLabel>}
        actions={<ActionButton disabled={publicIp.state === "running"} onClick={() => void runPublicIp(Boolean(publicIp.result))}>{publicIp.result ? "重新查询" : "查询 IP"}</ActionButton>}
      >
        {publicIp.result ? (
          <div className="network-diagnostics__ip-result">
            <div><span>公网地址</span><code>{maskIp ? maskIpAddress(publicIp.result.ip) : publicIp.result.ip}</code></div>
            <dl><div><dt>归属地</dt><dd>{publicIp.result.location || "未知"}</dd></div></dl>
          </div>
        ) : publicIp.state === "running" ? <div className="network-diagnostics__ip-skeleton" aria-hidden="true"><span /><span /></div> : <EmptyResult>暂未取得公网 IP，请检查网络后重新查询。</EmptyResult>}
      </DiagnosticBlock>

      <nav className="network-diagnostics__tabs" role="tablist" aria-label="诊断项目">
        {TABS.map((tab, index) => {
          const Icon = tab.icon
          return <button type="button" id={`diagnostic-tab-${tab.id}`} role="tab" aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => tabKey(event, index)} key={tab.id}><Icon aria-hidden="true" />{tab.label}</button>
        })}
      </nav>

      <div className="network-diagnostics__tabpanel" role="tabpanel" aria-labelledby={`diagnostic-tab-${activeTab}`}>
        {activeTab === "split" ? (
          <DiagnosticBlock
            title="网站分流测试"
            description="连接国内与国际网站的轻量探测端点，核对各站点实际使用的出口 IP。"
            status={<StatusLabel state={splitState}>{splitRunning ? `已完成 ${splitDone.length}/${targets.length}` : splitDone.length ? `检测到 ${splitExits.length} 个出口 IP` : `共 ${targets.length} 个站点`}</StatusLabel>}
            actions={<ActionButton disabled={splitRunning} onClick={() => void runSplit()}>{splitDone.length ? "重新检测" : "开始检测"}</ActionButton>}
          >
            {splitExits.length > 0 && <div className="network-diagnostics__exit-summary"><span>出口 IP 汇总</span><div>{splitExits.map((result) => <span key={result.ip}><CountryFlag countryCode={result.countryCode} /><code>{maskIp ? maskIpAddress(result.ip!) : result.ip}</code></span>)}</div></div>}
            <div className="network-diagnostics__table network-diagnostics__table--split" role="table" aria-label="网站分流检测结果">
              <div className="network-diagnostics__table-head" role="row"><span>网站</span><span>类型</span><span>出口 IP</span><span>归属地</span><span>状态</span></div>
              {splitResults.map((result) => (
                <div className="network-diagnostics__table-row" role="row" key={result.id}>
                  <div className="network-diagnostics__site"><SiteMark label={result.label} /><strong>{result.label}</strong></div>
                  <span data-label="类型">{result.category}</span>
                  <span data-label="出口 IP" className="network-diagnostics__address">{result.ip && <CountryFlag countryCode={result.countryCode} />}<code>{result.ip ? `${maskIp ? maskIpAddress(result.ip) : result.ip}${result.ipPrefix === undefined ? "" : `/${result.ipPrefix}`}` : result.state === "running" ? "检测中" : "-"}</code></span>
                  <span data-label="归属地">{result.location || "-"}</span>
                  <span data-label="状态"><StatusLabel state={result.state}>{result.state === "idle" ? "未检测" : result.state === "running" ? "连接中" : result.state === "success" ? `${result.duration} ms` : result.message || "失败"}</StatusLabel></span>
                </div>
              ))}
            </div>
          </DiagnosticBlock>
        ) : activeTab === "connectivity" ? (
          <DiagnosticBlock
            title="网络连通性测试"
            description="从当前浏览器测试常用站点的实时连通性与五轮中位延迟。"
            status={<StatusLabel state={connectivityRunning ? "running" : !connectivityDone.length ? "idle" : connectivityDone.some((result) => result.state === "error") ? "warning" : "success"}>{connectivityRunning ? `已完成 ${connectivityDone.length}/${CONNECTIVITY_TARGETS.length}` : connectivityDone.length ? `已完成 ${connectivityDone.length}/${CONNECTIVITY_TARGETS.length}` : `${CONNECTIVITY_TARGETS.length} 个站点`}</StatusLabel>}
            actions={<ActionButton disabled={connectivityRunning} onClick={() => void runConnectivity()}>{connectivityDone.length ? "重新测试" : "开始测试"}</ActionButton>}
          >
            <div className="network-diagnostics__connectivity-legend"><span><i data-level="fast" />低于 100 ms</span><span><i data-level="normal" />100 至 399 ms</span><span><i data-level="slow" />400 ms 以上</span><span><i data-level="timeout" />超时</span></div>
            <div className="network-diagnostics__connectivity-regions">
              {CONNECTIVITY_REGIONS.map((region) => {
                const results = connectivityResults.filter((result) => result.region === region.id)
                const done = results.filter((result) => ["success", "error"].includes(result.state))
                return (
                  <section className="network-diagnostics__connectivity-region" key={region.id}>
                    <header><CountryFlag countryCode={region.country} /><h3>{region.label}</h3><span>{done.length ? `已完成 ${done.length}/${results.length}` : "等待测试"}</span><button type="button" disabled={connectivityRunning} onClick={() => void runConnectivity(region.id)} aria-label={`重新测试${region.label}`}><RefreshCw aria-hidden="true" />刷新</button></header>
                    <div className="network-diagnostics__connectivity-grid">
                      {results.map((result) => {
                        const level = result.state === "error" ? "timeout" : getConnectivityLatencyLevel(result.latency)
                        return <div className="network-diagnostics__connectivity-item" key={result.id}><SiteMark label={result.name} /><div><strong>{result.name}</strong><span>{Array.from({ length: CONNECTIVITY_PROBE_ROUNDS }, (_, index) => <i data-level={getConnectivityLatencyLevel(result.samples[index])} key={index} />)}</span></div><b data-level={level}>{result.state === "running" ? "测试中" : result.state === "error" ? "超时" : result.latency === undefined ? "--" : `${result.latency} ms`}</b></div>
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          </DiagnosticBlock>
        ) : (
          <section className="network-diagnostics__card" aria-label="泄露检测">
            <DiagnosticBlock subsection title="DNS 泄露测试" description="通过随机 EDNS 域名识别当前网络实际使用的 DNS 解析器。" status={<StatusLabel state={dns.state}>{dns.message || "快速测试 5 次，深度测试 8 次"}</StatusLabel>} actions={<><ActionButton disabled={dns.state === "running"} onClick={() => void runDns(5)}>快速测试</ActionButton><ActionButton disabled={dns.state === "running"} onClick={() => void runDns(8)}>深度测试</ActionButton></>}>
              {dns.result?.resolvers.length ? <div className="network-diagnostics__table network-diagnostics__table--dns"><div className="network-diagnostics__table-head"><span>序号</span><span>解析器 IP</span><span>归属地</span><span>服务商</span><span>状态</span></div>{dns.result.resolvers.map((resolver, index) => <div className="network-diagnostics__table-row" key={resolver.ip}><span>{index + 1}</span><code data-label="解析器 IP">{maskIp ? maskIpAddress(resolver.ip) : resolver.ip}</code><span data-label="归属地">{resolver.location || "未知"}</span><span data-label="服务商">{resolver.provider || "未知"}</span><span data-label="状态"><StatusLabel state="success">已发现</StatusLabel></span></div>)}</div> : <EmptyResult>运行测试后显示 DNS 解析器地址、归属地和服务商。</EmptyResult>}
            </DiagnosticBlock>
            <DiagnosticBlock subsection title="WebRTC 泄露测试" description="通过多个 STUN 节点检查浏览器 UDP、IPv4 和 IPv6 出口。" status={<StatusLabel state={webRtc.state}>{webRtc.message || "不会请求摄像头或麦克风权限"}</StatusLabel>} actions={<ActionButton disabled={webRtc.state === "running"} onClick={() => void runWebRtc()}>{webRtc.result ? "重新检测" : "开始检测"}</ActionButton>}>
              {webRtc.result?.candidates.length ? <div className="network-diagnostics__table network-diagnostics__table--webrtc"><div className="network-diagnostics__table-head"><span>序号</span><span>候选地址</span><span>协议与类型</span><span>网络范围</span><span>状态</span></div>{webRtc.result.candidates.map((candidate, index) => <div className="network-diagnostics__table-row" key={`${candidate.address}-${candidate.protocol}-${candidate.type}`}><span>{index + 1}</span><code data-label="候选地址">{maskIp && !candidate.address.endsWith(".local") ? maskIpAddress(candidate.address) : candidate.address}</code><span data-label="协议与类型">{[candidate.protocol?.toUpperCase(), candidate.type].filter(Boolean).join(" / ") || "未知"}</span><span data-label="网络范围">{candidate.address.endsWith(".local") ? "mDNS 隐私地址" : candidate.private ? "局域网" : "公网"}</span><span data-label="状态"><WebRtcStatus candidate={candidate} baseline={baseline} /></span></div>)}</div> : <EmptyResult>运行测试后显示浏览器可见的 WebRTC 候选地址。</EmptyResult>}
            </DiagnosticBlock>
          </section>
        )}
      </div>
    </div>
  )
}
