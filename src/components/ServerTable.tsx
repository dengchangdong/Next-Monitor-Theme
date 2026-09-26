import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Filter,
  Search,
  Server as ServerIcon,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { ServerFlag } from "@/components/ServerFlag"
import { groupFilter, groupsOf, nodeMatchesGroup, type GroupFilter, type Node } from "@/lib/api"
import type { ThemeConfig } from "@/lib/config"
import { bytes, compact, expiresIn, percent, uptime } from "@/lib/format"
import { Link } from "@/lib/route"
import { cn } from "@/lib/utils"

type StatusFilter = "all" | "online" | "offline"
type SortKey = "sort" | "name" | "cpu" | "mem" | "disk" | "speed" | "expiry"
type Direction = "asc" | "desc"

type Renewal = {
  id: number
  name: string
  date: string
  days: number
}

/** A node that has reported once knows its shape; one that never connected has nothing to show. */
export function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

export function Dot({ node, className }: { node: Node; className?: string }) {
  return (
    <span
      title={node.online && !node.metrics ? "指标不可用" : node.online ? "在线" : deployed(node) ? "离线" : "未接入"}
      className={cn("probe-status-dot", (!node.online || !node.metrics) && "probe-status-dot--offline", className)}
    />
  )
}

export function Flag({ code, className }: { code: string; className?: string }) {
  return <ServerFlag code={code} className={className} />
}

function splitCompact(value: number) {
  const formatted = compact(value)
  const match = formatted.match(/^([\d.]+)(.*)$/)
  return { value: match?.[1] ?? "0", unit: (match?.[2] ?? "B").replace("B", "") || "B" }
}

function shortBytes(value: number) {
  return bytes(value, 1).replace(/([KMGTPE])B$/, "$1")
}

function formatDateTime(seconds: number) {
  if (!seconds) return "等待首次上报"
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function MetricValue({ value, direction }: { value: number | null; direction: "down" | "up" }) {
  const metric = value === null ? null : splitCompact(value)
  const Icon = direction === "down" ? ArrowDown : ArrowUp
  return (
    <span className={`probe-speed-metric probe-speed-metric--${direction}`}>
      <Icon aria-hidden="true" />
      <strong>{metric ? <>{metric.value}<small>{metric.unit}/s</small></> : "-"}</strong>
    </span>
  )
}

function PanelHeader({ title, description, action, id }: { title: string; description: string; action?: ReactNode; id?: string }) {
  return (
    <div className="status-panel__header">
      <div>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

function Dialog({ open, title, description, onClose, children }: {
  open: boolean
  title: string
  description: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null
  return (
    <dialog
      ref={ref}
      className="dashboard-dialog"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dashboard-dialog__header">
        <div><h2>{title}</h2><p>{description}</p></div>
        <button type="button" aria-label="关闭" onClick={onClose}><X /></button>
      </div>
      {children}
    </dialog>
  )
}

function NodeRow({ node }: { node: Node }) {
  const metrics = node.metrics
  const speedMetrics = node.online ? metrics : null
  const expiryDays = expiresIn(node)
  const expiryDate = node.expires_at || (node.price > 0 ? "长期" : "未设置")
  const remaining = expiryDays === null
    ? node.price > 0 ? "长期有效" : "未配置"
    : expiryDays < 0 ? "已过期" : `剩余 ${expiryDays}天`
  const waiting = node.online && !metrics
  const uptimeText = metrics?.uptime ? uptime(metrics.uptime).replace(/\s+/g, "") : "等待上报"
  const away = node.last_seen ? Math.max(0, Date.now() / 1000 - node.last_seen) : 0

  return (
    <Link href={`/node/${node.id}`} className={cn("probe-node-item", !node.online && "probe-node-item--offline")} aria-label={`查看 ${node.name} 详情`}>
      <div className="probe-node-item__identity">
        <Dot node={node} />
        <Flag code={node.country} className="probe-node-item__flag" />
        <span className="probe-node-item__name">
          <strong>{node.name}</strong>
          <small>{waiting ? "在线，等待首次指标" : node.online ? `已运行 ${uptimeText}` : deployed(node) ? `暂时离线，${away >= 60 ? `离线 ${uptime(away)}` : "刚刚离线"}` : "尚未接入"}</small>
        </span>
      </div>

      <div className="probe-node-item__speeds" aria-label="实时网络速度">
        <MetricValue value={speedMetrics?.net_rx ?? null} direction="down" />
        <MetricValue value={speedMetrics?.net_tx ?? null} direction="up" />
      </div>

      <div className="probe-node-item__resources" aria-label="资源占用">
        {([
          ["CPU", metrics?.cpu ?? null],
          ["内存", metrics ? percent(metrics.mem_used, metrics.mem_total) : null],
          ["硬盘", metrics ? percent(metrics.disk_used, metrics.disk_total) : null],
        ] as [string, number | null][]).map(([label, value]) => (
          <span key={label}>
            <small>{label}</small>
            <strong>{value === null ? "-" : `${value.toFixed(value % 1 ? 1 : 0)}%`}</strong>
          </span>
        ))}
      </div>

      <div className="probe-node-item__renewal">
        <small>{expiryDate}</small>
        <strong className={cn("probe-node-item__remaining", expiryDays !== null && expiryDays < 0 && "probe-node-item__remaining--expired")}>{remaining}</strong>
      </div>
      <ChevronRight className="probe-node-item__arrow" aria-hidden="true" />
    </Link>
  )
}

function sortValue(node: Node, key: SortKey): number | string {
  const metrics = node.metrics
  switch (key) {
    case "name": return node.name
    case "cpu": return metrics?.cpu ?? -1
    case "mem": return metrics ? percent(metrics.mem_used, metrics.mem_total) : -1
    case "disk": return metrics ? percent(metrics.disk_used, metrics.disk_total) : -1
    case "speed": return metrics ? metrics.net_rx + metrics.net_tx : -1
    case "expiry": return expiresIn(node) ?? Number.MAX_SAFE_INTEGER
    default: return node.sort
  }
}

export function ServerTables({ nodes, config }: { nodes: Node[]; config: ThemeConfig }) {
  const [status, setStatus] = useState<StatusFilter>("all")
  const [query, setQuery] = useState("")
  const [group, setGroup] = useState<GroupFilter>("all")
  const [sortKey, setSortKey] = useState<SortKey>("sort")
  const [direction, setDirection] = useState<Direction>("asc")
  const [renewalOpen, setRenewalOpen] = useState(false)
  const [trafficOpen, setTrafficOpen] = useState(false)

  useEffect(() => {
    const show = () => setTrafficOpen(true)
    window.addEventListener("monitor:show-traffic", show)
    return () => window.removeEventListener("monitor:show-traffic", show)
  }, [])

  const groups = useMemo(() => groupsOf(nodes), [nodes])
  const groupAvailable = group === "all"
    || (group === "ungrouped" && nodes.some((node) => !(node.group ?? "")))
    || (group.startsWith("named:") && groups.includes(group.slice("named:".length)))
  const activeGroup: GroupFilter = groupAvailable ? group : "all"
  const scoped = nodes.filter((node) => nodeMatchesGroup(node, activeGroup))
  const online = scoped.filter((node) => node.online && node.metrics)
  const onlineCount = scoped.filter((node) => node.online).length
  const unavailableCount = scoped.filter((node) => node.online && !node.metrics).length
  const offline = scoped.filter((node) => !node.online).length
  const total = (pick: (node: Node) => number) => online.reduce((sum, node) => sum + pick(node), 0)
  const resourceAverage = (pick: (node: Node) => number) => online.length ? total(pick) / online.length : null
  const renewals = scoped.reduce<Renewal[]>((items, node) => {
    const days = expiresIn(node)
    if (days !== null && days <= 30) items.push({ id: node.id, name: node.name, date: node.expires_at || "未设置", days })
    return items
  }, []).sort((a, b) => a.days - b.days)
  const tracked = scoped.filter((node) => Boolean(node.expires_at)).length
  const perpetual = scoped.filter((node) => !node.expires_at && node.price > 0).length
  const nearest = scoped
    .map((node) => ({ node, days: expiresIn(node) }))
    .filter((item): item is { node: Node; days: number } => item.days !== null && item.days >= 0)
    .sort((a, b) => a.days - b.days)[0]

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return nodes
      .filter((node) => status === "all" || (status === "online" ? node.online : !node.online))
      .filter((node) => nodeMatchesGroup(node, activeGroup))
      .filter((node) => !needle || `${node.name} ${node.country} ${node.group ?? ""} ${node.os}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const left = sortValue(a, sortKey)
        const right = sortValue(b, sortKey)
        const result = typeof left === "string" && typeof right === "string" ? left.localeCompare(right, "zh-CN") : Number(left) - Number(right)
        return direction === "asc" ? result : -result
      })
  }, [activeGroup, direction, nodes, query, sortKey, status])

  const allState = scoped.length === 0 ? "empty" : offline === 0 && unavailableCount === 0 ? "operational" : "attention"
  const updatedAt = Math.max(...scoped.map((node) => node.last_seen), 0)
  const availability = scoped.length ? (onlineCount / scoped.length) * 100 : 0
  const latestRenewal = nearest ? `${nearest.days} 天` : tracked ? "暂无" : "长期"
  const cpuAverage = resourceAverage((node) => node.metrics!.cpu)
  const memoryAverage = resourceAverage((node) => percent(node.metrics!.mem_used, node.metrics!.mem_total))
  const diskAverage = resourceAverage((node) => percent(node.metrics!.disk_used, node.metrics!.disk_total))

  return (
    <div className="status-page">
      <section className="status-hero" aria-labelledby="system-status-title">
        <span className={cn("status-hero__mark", allState === "attention" && "status-hero__mark--offline")} aria-hidden="true"><span /></span>
        <h1 id="system-status-title">系统状态</h1>
        <div className={cn("status-hero__state", `status-hero__state--${allState}`)}>
          <span className={cn("probe-status-dot", (offline > 0 || unavailableCount > 0) && "probe-status-dot--offline")} />
          {scoped.length === 0 ? "暂无节点数据" : offline ? `${offline} 台节点需要关注` : unavailableCount ? `${unavailableCount} 台节点等待指标` : "所有节点运行正常"}
        </div>
        <p>最后更新：{formatDateTime(updatedAt)}</p>
      </section>

      {config.notice && (
        <section className="status-notice status-notice--announcement" role="note">
          <AlertCircle aria-hidden="true" />
          <div><strong>站点公告</strong><p>{config.notice}</p></div>
        </section>
      )}

      {(offline > 0 || unavailableCount > 0) && (
        <section className="status-notice" role="status">
          <AlertCircle aria-hidden="true" />
          <div><strong>部分节点数据不可用</strong><p>{offline > 0 ? `${offline} 台节点暂时离线。` : ""}{unavailableCount > 0 ? `${unavailableCount} 台节点已连接但尚未上报完整指标。` : ""}</p></div>
        </section>
      )}

      {config.show_network && <section className="status-panel status-network" id="network-status" aria-labelledby="network-status-title">
        <PanelHeader id="network-status-title" title="实时网络" description={`${scoped.length} 台服务器的当前吞吐`} action={<span className="status-panel__live"><span className="probe-status-dot" />实时</span>} />
        <div className="status-network__grid">
          {([
            ["down", "当前下行", total((node) => node.metrics!.net_rx), scoped.reduce((sum, node) => sum + node.day_rx, 0)],
            ["up", "当前上行", total((node) => node.metrics!.net_tx), scoped.reduce((sum, node) => sum + node.day_tx, 0)],
          ] as const).map(([kind, label, speed, traffic]) => {
            const metric = online.length === 0 && unavailableCount > 0 ? null : splitCompact(speed)
            const Icon = kind === "down" ? ArrowDown : ArrowUp
            return (
              <div className={`status-network__metric status-network__metric--${kind}`} key={kind}>
                <span><Icon aria-hidden="true" />{label}</span>
                <strong>{metric ? <>{metric.value}<small>{metric.unit}/s</small></> : "-"}</strong>
                <p>今日流量 {shortBytes(traffic)}</p>
              </div>
            )
          })}
        </div>
      </section>}

      <section className="status-panel status-current" id="node-list" aria-labelledby="current-status-title">
        <PanelHeader id="current-status-title" title="节点状态" description="实时速度、资源占用与续费周期" action={<span>{onlineCount}/{scoped.length} 在线</span>} />
        <div className="status-controls">
          <div className="status-controls__states" aria-label="节点状态筛选">
            {([
              ["all", "全部状态", scoped.length],
              ["online", "在线节点", onlineCount],
              ["offline", "离线节点", offline],
            ] as const).map(([value, label, count]) => (
              <button type="button" key={value} className={cn(status === value && "status-controls__state--active")} aria-pressed={status === value} onClick={() => setStatus(value)}>
                <span>{label}</span><strong>{count}</strong>
              </button>
            ))}
          </div>
          <div className="status-controls__toolbar">
            <label className="status-controls__search">
              <span className="sr-only">搜索节点</span><Search aria-hidden="true" />
              <input id="node-search" type="search" value={query} placeholder="搜索节点" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="status-controls__select" title="节点分组">
              <Filter aria-hidden="true" />
              <select aria-label="节点分组" value={activeGroup} onChange={(event) => setGroup(event.target.value as GroupFilter)}>
                <option value="all">全部节点</option>
                {nodes.some((node) => !(node.group ?? "")) && <option value="ungrouped">未分组</option>}
                {groups.map((name) => <option key={name} value={groupFilter(name)}>{name}</option>)}
              </select>
              <ChevronDown aria-hidden="true" />
            </label>
            <label className="status-controls__select status-controls__sort" title="排序字段">
              <select aria-label="排序字段" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                <option value="sort">排序值</option><option value="name">节点名称</option><option value="cpu">CPU</option><option value="mem">内存</option><option value="disk">硬盘</option><option value="speed">网络速度</option><option value="expiry">到期时间</option>
              </select>
              <ChevronDown aria-hidden="true" />
            </label>
            <button className="status-controls__direction" type="button" aria-label={direction === "asc" ? "当前升序，切换为降序" : "当前降序，切换为升序"} onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")}>
              {direction === "asc" ? <ArrowDown /> : <ArrowUp />}
            </button>
          </div>
        </div>
        <div className="status-current__list">
          {filtered.length ? filtered.map((node) => <NodeRow key={node.id} node={node} />) : (
            <div className="status-current__empty"><ServerIcon aria-hidden="true" /><strong>没有匹配的节点</strong><span>请调整状态、分组或搜索条件</span></div>
          )}
        </div>
      </section>

      <section className="status-facts" aria-label="运行概览">
        <div><strong>{availability.toFixed(1)}%</strong><span>当前在线率</span></div>
        <div><strong>{onlineCount}</strong><span>在线节点</span></div>
        <div><strong>{tracked}</strong><span>已配置到期</span></div>
        <button type="button" className="status-facts__action" onClick={() => setRenewalOpen(true)}><strong>{renewals.length}</strong><span>续费提醒</span></button>
      </section>

      {config.show_resources && <section className="status-panel status-resources" id="resource-status" aria-labelledby="resource-title">
        <PanelHeader id="resource-title" title="资源使用" description="当前在线节点的平均资源占用" />
        <div className="status-resources__grid">
          <div><span>CPU</span><strong>{cpuAverage === null ? "-" : `${cpuAverage.toFixed(1)}%`}</strong></div>
          <div><span>内存</span><strong>{memoryAverage === null ? "-" : `${memoryAverage.toFixed(1)}%`}</strong></div>
          <div><span>硬盘</span><strong>{diskAverage === null ? "-" : `${diskAverage.toFixed(1)}%`}</strong></div>
        </div>
      </section>}

      {config.show_renewal && <section className="status-panel status-billing" aria-labelledby="billing-title">
        <PanelHeader id="billing-title" title="到期与续费" description="基于节点公开配置中的账单周期" />
        <div className="status-billing__body">
          <div className="status-billing__nearest"><span>最近到期</span><strong>{latestRenewal}</strong><p>{nearest ? `${nearest.node.name}，到期 ${nearest.node.expires_at}` : tracked ? "当前没有临近到期节点" : "尚未配置节点到期时间"}</p></div>
          <div className="status-billing__counts">
            <span><strong>{renewals.filter((item) => item.days >= 0).length}</strong>30 天内到期</span>
            <span><strong>{renewals.filter((item) => item.days < 0).length}</strong>已过期</span>
            <span><strong>{perpetual}</strong>长期有效</span>
          </div>
        </div>
      </section>}

      <Dialog open={renewalOpen} title="续费提醒" description="以下服务器将在 30 天内到期或已经过期" onClose={() => setRenewalOpen(false)}>
        <div className="status-renewal-list">
          {renewals.length ? renewals.map((item) => (
            <Link key={item.id} href={`/node/${item.id}`} className="status-renewal-list__item" onClick={() => setRenewalOpen(false)}>
              <span><AlertCircle aria-hidden="true" /><strong>{item.name}</strong></span>
              <span><small>{item.date}</small><strong className={cn(item.days < 0 && "is-expired")}>{item.days < 0 ? "已过期" : `剩余 ${item.days} 天`}</strong></span>
              <ChevronRight aria-hidden="true" />
            </Link>
          )) : <div className="dashboard-empty">当前没有需要续费的服务器</div>}
        </div>
      </Dialog>

      <Dialog open={trafficOpen} title="今日流量" description="统计周期 00:00 至当前时间" onClose={() => setTrafficOpen(false)}>
        <div className="dashboard-transfer-list">
          {scoped.length ? scoped.map((node) => (
            <div className="dashboard-transfer-row" key={node.id}>
              <span><Dot node={node} /><strong>{node.name}</strong></span>
              <span><small className="traffic-down">↓ {shortBytes(node.day_rx)}</small><small className="traffic-up">↑ {shortBytes(node.day_tx)}</small><small>⊙ {shortBytes(node.day_rx + node.day_tx)}</small></span>
            </div>
          )) : <div className="dashboard-empty">当前没有服务器流量数据</div>}
        </div>
      </Dialog>
    </div>
  )
}
