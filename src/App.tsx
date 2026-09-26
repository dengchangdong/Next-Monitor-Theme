import { Activity, ArrowDownUp, Map, Route, Search, UserRound } from "lucide-react"
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from "react"

import { ServerTables } from "@/components/ServerTable"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes, type Node } from "@/lib/api"
import { defaultThemeConfig, loadThemeConfig, type ThemeConfig } from "@/lib/config"
import { Link, useRoute } from "@/lib/route"
import { serverIdToServerKey } from "@/lib/server-key"

type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean }

const NodeDetail = lazy(() => import("@/components/NodeDetail").then((module) => ({ default: module.NodeDetail })))
const NodeMapDialog = lazy(() => import("@/components/NodeMapDialog").then((module) => ({ default: module.NodeMapDialog })))
const NetworkDiagnostics = lazy(() => import("@/pages/NetworkDiagnostics"))

function focusSection(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
}

const SiteHeader = memo(function SiteHeader({ site, authed, onHome, onMap }: { site: string; authed: boolean; onHome: boolean; onMap: () => void }) {
  const focusSearch = () => {
    const run = () => {
      focusSection("node-list")
      setTimeout(() => document.getElementById("node-search")?.focus(), 350)
    }
    if (onHome) run()
    else setTimeout(run, 0)
  }

  return (
    <header className="probe-site-header">
      <div className="probe-site-header__inner">
        <Link href="/" className="probe-site-brand" aria-label="返回系统状态">
          <span className="probe-site-brand__mark" aria-hidden="true"><Activity /></span>
          <span><strong>{site}</strong><small>服务状态</small></span>
        </Link>
        <nav className="probe-site-actions" aria-label="页面工具">
          {onHome ? (
            <button type="button" className="probe-site-action" aria-label="搜索节点" title="搜索节点" onClick={focusSearch}><Search /></button>
          ) : (
            <Link href="/" className="probe-site-action" aria-label="搜索节点" title="搜索节点" onClick={focusSearch}><Search /></Link>
          )}
          <Link href="/network" className="probe-site-action" aria-label="网络与 IP 检测" title="网络与 IP 检测"><Route /></Link>
          {onHome ? (
            <button type="button" className="probe-site-action" aria-label="查看今日流量" title="查看今日流量" onClick={() => window.dispatchEvent(new Event("monitor:show-traffic"))}><ArrowDownUp /></button>
          ) : (
            <Link href="/" className="probe-site-action" aria-label="查看今日流量" title="查看今日流量" onClick={() => setTimeout(() => window.dispatchEvent(new Event("monitor:show-traffic")), 50)}><ArrowDownUp /></Link>
          )}
          <button type="button" className="probe-site-action" aria-label="打开节点地图" title="节点地图" onClick={onMap}><Map /></button>
          <a className="probe-site-action" href="/dashboard/" aria-label={authed ? "管理后台" : "登录后台"} title={authed ? "管理后台" : "登录后台"}><UserRound /></a>
        </nav>
      </div>
    </header>
  )
})

function LoadingPage() {
  return (
    <div className="status-page status-page--loading" aria-label="正在加载服务器状态">
      <div className="status-loading-hero"><Skeleton /><Skeleton /><Skeleton /></div>
      <Skeleton className="status-loading-panel" />
      <Skeleton className="status-loading-panel status-loading-panel--large" />
      <span className="sr-only">加载中</span>
    </div>
  )
}

function MissingNode() {
  return (
    <div className="status-page">
      <section className="status-panel missing-node">
        <h1>节点不存在或未公开</h1>
        <p>该节点可能已被删除、设为私有，或链接已失效。</p>
        <Link href="/">返回服务器列表</Link>
      </section>
    </div>
  )
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [themeConfig, setThemeConfig] = useState<ThemeConfig | null>(null)
  const [meError, setMeError] = useState("")
  const [mapOpen, setMapOpen] = useState(false)
  const { nodes, error, closed } = useNodes()
  const route = useRoute()

  const loadMe = useCallback(() => {
    return api<Me>("/me")
      .then((next) => {
        setMe(next)
        setMeError("")
      })
      .catch((reason: Error) => setMeError(reason.message))
  }, [])

  useEffect(() => {
    void loadMe()
    void loadThemeConfig().then(setThemeConfig)
  }, [loadMe])

  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/dashboard/"
  }, [me])

  // Live frames replace data in place. The page shell, header and each keyed
  // node row stay mounted, so filters, scroll position and open dialogs survive.
  const sorted = useMemo(() => [...(nodes ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id), [nodes])
  const selected: Node | undefined = route.kind === "server" ? sorted.find((node) => serverIdToServerKey(node.id) === route.key) : undefined
  const site = me?.site_name || "节点监控"

  useEffect(() => {
    const page = route.kind === "network" ? "网络与 IP 检测" : route.kind === "missing" ? "页面不存在" : selected?.name
    document.title = [page, site].filter(Boolean).join(" - ")
  }, [route.kind, selected?.name, site])

  if (me && !me.public_page && !me.authed) return null

  return (
    <div className="probe-workspace">
      <SiteHeader site={site} authed={Boolean(me?.authed)} onHome={route.kind === "home"} onMap={() => setMapOpen(true)} />
      <main className="probe-main">
        {meError && !me ? (
          <div className="status-page"><div className="status-error" role="alert"><strong>站点信息加载失败</strong><span>{meError}</span><button type="button" onClick={loadMe}>重试</button></div></div>
        ) : !me || (route.kind !== "network" && (!nodes || !themeConfig)) ? (
          <LoadingPage />
        ) : (
          <>
            {error && <div className="status-error status-error--floating" role="alert"><strong>实时连接暂时不可用</strong><span>{error}</span></div>}
            {route.kind === "home" ? (
              <ServerTables nodes={sorted} config={themeConfig ?? defaultThemeConfig} />
            ) : route.kind === "network" ? (
              <Suspense fallback={<LoadingPage />}><NetworkDiagnostics /></Suspense>
            ) : route.kind === "server" && selected ? (
              <Suspense fallback={<div className="server-detail-page"><Skeleton className="probe-skeleton--detail-head" /><Skeleton className="probe-skeleton--detail-panel" /><Skeleton className="probe-skeleton--detail-chart" /></div>}>
                <NodeDetail node={selected} config={themeConfig ?? defaultThemeConfig} />
              </Suspense>
            ) : (
              <MissingNode />
            )}
          </>
        )}
      </main>
      {mapOpen && <Suspense fallback={null}><NodeMapDialog nodes={sorted} open={mapOpen} onClose={() => setMapOpen(false)} /></Suspense>}
    </div>
  )
}
