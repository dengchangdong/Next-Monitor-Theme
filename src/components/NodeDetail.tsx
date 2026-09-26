import { ArrowDown, ArrowLeft, ArrowUp, RotateCw } from "lucide-react"
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Flag, deployed } from "@/components/ServerTable"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Node } from "@/lib/api"
import type { ThemeConfig } from "@/lib/config"
import { axisBytes, axisTop, bytes, clockFor, despike, expiresIn, quarters, rate, timeTicks, uptime } from "@/lib/format"
import { Link } from "@/lib/route"
import { cn } from "@/lib/utils"

type MetricPoint = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
}

type PingPoint = {
  task_id: number
  ts: number
  latency: number | null
  loss?: number
}

type History = {
  metrics: MetricPoint[]
  ping: PingPoint[]
  probes: Record<string, string>
  loss?: Record<string, number>
}

type Range = { minutes: number; label: string }

const RANGES: Range[] = [
  { minutes: 30, label: "30分钟" },
  { minutes: 60, label: "1小时" },
  { minutes: 180, label: "3小时" },
  { minutes: 360, label: "6小时" },
  { minutes: 720, label: "12小时" },
  { minutes: 1440, label: "24小时" },
]

const CHART_COLORS = ["#5aa5b6", "#d97a59", "#8a75b8", "#c79a3b", "#4385b6"]
const SPEED_IN_COLOR = "#d97a59"
const SPEED_OUT_COLOR = "#3183a7"
const AXIS = { stroke: "#6d7c90", fontSize: 10, tickLine: false, axisLine: false }
const TOOLTIP_STYLE = {
  fontSize: 11,
  background: "var(--probe-surface)",
  color: "var(--probe-text)",
  border: "1px solid var(--probe-border)",
  borderRadius: "5px",
}

function useHistory(id: number, hours: number, series: "metrics" | "ping") {
  const key = `${id}:${hours}:${series}`
  const [result, setResult] = useState<{ key: string; data: History | null; failed: string }>({ key: "", data: null, failed: "" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const points = Math.min(1440, Math.max(60, Math.round(globalThis.innerWidth * (globalThis.devicePixelRatio || 1))))
    api<History>(`/nodes/${id}/metrics?hours=${hours}&points=${points}&series=${series}`)
      .then((next) => {
        if (active) setResult({ key, data: next, failed: "" })
      })
      .catch((error: Error) => {
        if (!active) return
        setResult({ key, failed: error.message, data: { metrics: [], ping: [], probes: {} } })
      })
    return () => {
      active = false
    }
  }, [attempt, hours, id, key, series])

  return {
    data: result.key === key ? result.data : null,
    failed: result.key === key ? result.failed : "",
    retry: () => setAttempt((value) => value + 1),
  }
}

function formatDateTime(seconds: number) {
  if (!seconds) return "-"
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function shortBytes(value: number) {
  return bytes(value, 1).replace(/([KMGTPE])B$/, "$1")
}

function shortRate(value: number) {
  return rate(value).replace(/([KMGTPE])B\//, "$1/")
}

function timeAxis(rows: { ts: number }[], minutes: number) {
  const hours = minutes / 60
  return {
    dataKey: "ts",
    type: "number" as const,
    domain: rows.length ? [rows[0].ts, rows[rows.length - 1].ts] : ["dataMin", "dataMax"],
    ticks: rows.length ? timeTicks(rows[0].ts, rows[rows.length - 1].ts, 6) : undefined,
    tickFormatter: clockFor(hours),
    minTickGap: 26,
    ...AXIS,
  }
}

function Failed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="chart-empty" role="alert">
      <span>历史数据加载失败：{message}</span>
      <button type="button" onClick={retry}>重试</button>
    </div>
  )
}

function RangeTabs({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  return (
    <div className="monitor-ranges" aria-label="图表时间范围">
      <span>最近</span>
      {RANGES.map((range) => (
        <button type="button" key={range.minutes} className={cn(value === range.minutes && "is-active")} onClick={() => onChange(range.minutes)}>
          {range.label}
        </button>
      ))}
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" className="monitor-switch" aria-pressed={checked} onClick={onChange}>
      <span>{label}</span><i className={cn(checked && "is-active")}><b /></i>
    </button>
  )
}

type ProbeSeries = {
  id: number
  name: string
  loss: number
  rows: Array<{ ts: number; value: number | null }>
}

function ProbeChart({ series, minutes, color }: { series: ProbeSeries; minutes: number; color: string }) {
  return (
    <div className="latency-probe">
      <div className="latency-probe__legend">
        <span><i style={{ backgroundColor: color }} />{series.name}</span>
        <span>延时 <strong>{series.rows.at(-1)?.value == null ? "-" : `${Math.round(series.rows.at(-1)!.value!)}ms`}</strong></span>
        <span>丢包 <strong className={cn(series.loss > 0 && "has-loss")}>{series.loss > 0 && series.loss < 0.1 ? "<0.1" : series.loss.toFixed(1)}%</strong></span>
      </div>
      <div className="latency-probe__chart">
        <ResponsiveContainer>
          <LineChart data={series.rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid className="chart-grid" vertical />
            <XAxis {...timeAxis(series.rows, minutes)} />
            <YAxis width={42} domain={[0, "auto"]} unit="ms" {...AXIS} />
            <Tooltip labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")} formatter={(value) => [`${Math.round(Number(value))} ms`, series.name]} contentStyle={TOOLTIP_STYLE} />
            <Line dataKey="value" name={series.name} stroke={color} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function Latency({ id, className }: { id: number; className?: string }) {
  const [minutes, setMinutes] = useState(1440)
  const [aggregate, setAggregate] = useState(false)
  const [smooth, setSmooth] = useState(false)
  const hours = Math.max(1, Math.ceil(minutes / 60))
  const { data, failed, retry } = useHistory(id, hours, "ping")

  const series = useMemo<ProbeSeries[]>(() => {
    const all = data?.ping ?? []
    const latest = all.reduce((max, point) => Math.max(max, point.ts), 0)
    const cutoff = latest - minutes * 60
    return [...new Set(all.map((point) => point.task_id))].map((taskId) => {
      const points = all.filter((point) => point.task_id === taskId && point.ts >= cutoff).sort((a, b) => a.ts - b.ts)
      const values = smooth ? despike(points.map((point) => point.latency), 7) : points.map((point) => point.latency)
      return {
        id: taskId,
        name: data?.probes?.[taskId] ?? `探测 ${taskId}`,
        loss: data?.loss?.[taskId] ?? 0,
        rows: points.map((point, index) => ({ ts: point.ts * 1000, value: values[index] })),
      }
    }).filter((item) => item.rows.length > 0)
  }, [data, minutes, smooth])

  const aggregateRows = useMemo(() => {
    const rows = new Map<number, { ts: number } & Record<string, number | null>>()
    series.forEach((item) => item.rows.forEach((point) => {
      const row = rows.get(point.ts) ?? { ts: point.ts }
      row[`p${item.id}`] = point.value
      rows.set(point.ts, row)
    }))
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [series])

  return (
    <section className={cn("server-monitor", className)} aria-labelledby="latency-title">
      <div className="server-monitor__header">
        <h2 id="latency-title">网络监控</h2>
        <div className="server-monitor__controls">
          <Switch label="聚合" checked={aggregate} onChange={() => setAggregate((value) => !value)} />
          <button type="button" className="monitor-refresh" onClick={retry}><span>刷新</span><RotateCw /></button>
          <Switch label="削峰" checked={smooth} onChange={() => setSmooth((value) => !value)} />
          <RangeTabs value={minutes} onChange={setMinutes} />
        </div>
      </div>

      {!data ? <Skeleton className="probe-skeleton--latency" /> : failed ? <Failed message={failed} retry={retry} /> : !series.length ? (
        <div className="chart-empty">这段时间没有延迟数据</div>
      ) : aggregate ? (
        <div className="latency-probe latency-probe--aggregate">
          <div className="latency-probe__legend latency-probe__legend--aggregate">
            {series.map((item, index) => <span key={item.id}><i style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />{item.name}</span>)}
          </div>
          <div className="latency-probe__chart">
            <ResponsiveContainer>
              <LineChart data={aggregateRows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid className="chart-grid" vertical />
                <XAxis {...timeAxis(aggregateRows, minutes)} />
                <YAxis width={42} domain={[0, "auto"]} unit="ms" {...AXIS} />
                <Tooltip labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")} contentStyle={TOOLTIP_STYLE} />
                {series.map((item, index) => <Line key={item.id} dataKey={`p${item.id}`} name={item.name} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="latency-grid">{series.map((item, index) => <ProbeChart key={item.id} series={item} minutes={minutes} color={CHART_COLORS[index % CHART_COLORS.length]} />)}</div>
      )}
    </section>
  )
}

function ResourceRing({ label, value, detail, color }: { label: string; value: number | null; detail?: string; color: string }) {
  const safeValue = value === null ? 0 : Math.max(0, Math.min(100, value))
  const style = { "--ring-value": `${safeValue}%`, "--ring-color": color } as CSSProperties
  return (
    <div className="resource-ring">
      <div className="resource-ring__circle" style={style}>
        <div><strong>{value === null ? "-" : `${safeValue.toFixed(safeValue % 1 ? 1 : 0)}%`}</strong>{detail && <small>{detail}</small>}</div>
      </div>
      <span>{label}</span>
    </div>
  )
}

function PriorityMetric({ label, value, kind, icon }: { label: string; value: ReactNode; kind?: string; icon?: "down" | "up" }) {
  return (
    <div className={cn("probe-detail-priority__item", kind && `probe-detail-priority__${kind}`)}>
      <span>{icon === "down" ? <ArrowDown /> : icon === "up" ? <ArrowUp /> : null}{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="server-info-row"><strong>{label}</strong><span>{children}</span></div>
}

function SpeedChart({ node }: { node: Node }) {
  const [minutes, setMinutes] = useState(1440)
  const hours = Math.max(1, Math.ceil(minutes / 60))
  const { data, failed, retry } = useHistory(node.id, hours, "metrics")
  const rows = useMemo(() => {
    const all = (data?.metrics ?? []).map((point) => ({ ...point, ts: point.ts * 1000 }))
    const latest = all.at(-1)?.ts ?? 0
    return all.filter((point) => point.ts >= latest - minutes * 60_000)
  }, [data, minutes])
  const top = axisTop(rows.reduce((max, point) => Math.max(max, point.net_rx, point.net_tx), 0), 1024, 1024)
  const currentIn = node.online ? node.metrics?.net_rx ?? 0 : 0
  const currentOut = node.online ? node.metrics?.net_tx ?? 0 : 0
  const maxIn = rows.reduce((max, point) => Math.max(max, point.net_rx), currentIn)
  const maxOut = rows.reduce((max, point) => Math.max(max, point.net_tx), currentOut)

  return (
    <section className="server-monitor" aria-labelledby="speed-title">
      <div className="server-monitor__header">
        <h2 id="speed-title">网络速度</h2>
        <RangeTabs value={minutes} onChange={setMinutes} />
      </div>
      <div className="speed-legends">
        <div><span><i style={{ backgroundColor: SPEED_IN_COLOR }} />下载</span><small>当前</small><strong>{shortRate(currentIn)}</strong><small>最高</small><strong>{shortRate(maxIn)}</strong></div>
        <div><span><i style={{ backgroundColor: SPEED_OUT_COLOR }} />上传</span><small>当前</small><strong>{shortRate(currentOut)}</strong><small>最高</small><strong>{shortRate(maxOut)}</strong></div>
      </div>
      {!data ? <Skeleton className="probe-skeleton--speed" /> : failed ? <Failed message={failed} retry={retry} /> : !rows.length ? <div className="chart-empty">这段时间没有速度数据</div> : (
        <div className="speed-chart">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid className="chart-grid" vertical />
              <XAxis {...timeAxis(rows, minutes)} />
              <YAxis width={58} domain={[0, top]} ticks={quarters(top)} tickFormatter={axisBytes} {...AXIS} />
              <Tooltip labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")} formatter={(value) => shortRate(Number(value))} contentStyle={TOOLTIP_STYLE} />
              <Line dataKey="net_rx" name="下载" stroke={SPEED_IN_COLOR} strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line dataKey="net_tx" name="上传" stroke={SPEED_OUT_COLOR} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

function cpuBrand(name: string) {
  const normalized = name.toLowerCase()
  if (normalized.includes("intel")) return "intel"
  if (normalized.includes("amd")) return "AMD"
  if (normalized.includes("apple")) return "Apple"
  return "CPU"
}

export function NodeDetail({ node, config }: { node: Node; config: ThemeConfig }) {
  const metrics = node.metrics
  const onlineMetrics = node.online ? metrics : null
  const expiryDays = expiresIn(node)
  const cpu = node.cpu_name.replace(/\((R|TM)\)/gi, "").replace(/\s+(CPU|Processor)\b/gi, "").replace(/\s+/g, " ").trim()
  const brand = cpuBrand(node.cpu_name)
  const model = cpu.replace(new RegExp(brand, "i"), "").trim()
  const totalTraffic = node.total_rx + node.total_tx
  const away = node.last_seen ? Math.max(0, Date.now() / 1000 - node.last_seen) : 0
  const startTime = metrics?.uptime ? Math.floor(Date.now() / 1000 - metrics.uptime) : 0
  const stateText = node.online && !metrics ? "指标不可用" : node.online ? "正在运行" : deployed(node) ? "暂时离线" : "尚未接入"
  const speed = (value: number) => {
    const display = shortRate(value).replace("/s", "")
    const match = display.match(/^([\d.]+)\s*(.*)$/)
    return <>{match?.[1] ?? "0"}<small>{match?.[2] ?? "B"}/s</small></>
  }

  return (
    <div className={cn("server-detail-page", !node.online && "server-detail-page--offline")}>
      <div className="server-detail-page__topbar">
        <Link href="/" className="server-detail-page__back"><ArrowLeft />返回服务器列表</Link>
        <strong>节点详情</strong>
        <span className={cn("server-detail-page__state", (!node.online || !metrics) && "is-offline")}><i />{stateText}</span>
      </div>

      <section className="server-detail-header">
        <Flag code={node.country} className="server-detail-header__flag" />
        <div>
          <h1>{node.name}</h1>
          <p><strong className={`cpu-brand cpu-brand--${brand.toLowerCase()}`}>{brand}</strong><span>{model || `${node.cpu_cores} 核`}</span></p>
        </div>
      </section>

      <section className="probe-detail-priority" aria-label="实时网络与到期信息">
        <PriorityMetric label="当前下行" value={onlineMetrics ? speed(onlineMetrics.net_rx) : "-"} kind="speed--down" icon="down" />
        <PriorityMetric label="当前上行" value={onlineMetrics ? speed(onlineMetrics.net_tx) : "-"} kind="speed--up" icon="up" />
        <PriorityMetric label="到期时间" value={node.expires_at || "未设置"} />
        <PriorityMetric label="剩余天数" value={expiryDays === null ? "未配置" : expiryDays < 0 ? "已过期" : `${expiryDays}天`} kind={expiryDays !== null && expiryDays < 0 ? "remaining--expired" : "remaining"} />
      </section>

      <section className="server-detail-status" aria-label="资源占用">
        <div className="server-detail-status__rings">
          <ResourceRing label="CPU" value={metrics?.cpu ?? null} color="#3183a7" />
          <ResourceRing label="内存" value={metrics ? (metrics.mem_used / Math.max(metrics.mem_total, 1)) * 100 : null} detail={metrics ? `${shortBytes(metrics.mem_used)}/${shortBytes(metrics.mem_total)}` : undefined} color="#0aa579" />
          <ResourceRing label="交换" value={metrics ? (metrics.swap_used / Math.max(metrics.swap_total, 1)) * 100 : null} detail={metrics ? metrics.swap_total ? `${shortBytes(metrics.swap_used)}/${shortBytes(metrics.swap_total)}` : "未启用" : undefined} color="#d08a11" />
          <ResourceRing label="硬盘" value={metrics ? (metrics.disk_used / Math.max(metrics.disk_total, 1)) * 100 : null} detail={metrics ? `${shortBytes(metrics.disk_used)}/${shortBytes(metrics.disk_total)}` : undefined} color="#43b4c2" />
        </div>
        <div className="server-detail-status__facts">
          <div><strong>{metrics ? uptime(metrics.uptime).replace(/\s+/g, "") : "-"}</strong><span>在线</span></div>
          <div><strong>{shortBytes(totalTraffic)}</strong><span>流量</span></div>
        </div>
      </section>

      <section className="server-detail-info" aria-label="节点信息">
        <InfoRow label="CPU">{cpu || `${node.cpu_cores} 核`}</InfoRow>
        <InfoRow label="架构">{[node.arch, node.virt !== "none" && node.virt].filter(Boolean).join(" · ") || "-"}</InfoRow>
        <InfoRow label="系统">{[node.os, node.kernel].filter(Boolean).join(" · ") || "-"}</InfoRow>
        <InfoRow label="占用">进程数 {metrics?.procs ?? 0}　负载 {metrics?.load.map((value) => value.toFixed(2)).join(",") ?? "-"}</InfoRow>
        <InfoRow label="流量">已用 {shortBytes(totalTraffic)}　今日 {shortBytes(node.day_rx + node.day_tx)}</InfoRow>
        <InfoRow label="连接">TCP {metrics?.tcp ?? 0}　UDP {metrics?.udp ?? 0}</InfoRow>
        <InfoRow label="启动">{formatDateTime(startTime)}</InfoRow>
        <InfoRow label="活跃">{formatDateTime(node.last_seen)}{!node.online && away >= 60 ? `（${uptime(away)}前）` : ""}</InfoRow>
        <InfoRow label="标签"><span className="server-tags">{[node.group, node.agent_version && `agent ${node.agent_version}`].filter(Boolean).map((tag) => <i key={tag}>{tag}</i>)}</span></InfoRow>
      </section>

      {config.show_speed_chart && <SpeedChart node={node} />}
      {config.show_latency_chart && <Latency id={node.id} />}
    </div>
  )
}
