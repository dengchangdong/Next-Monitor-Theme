import { useMemo, useState } from "react"

import worldMapUrl from "@/assets/world-map.svg?url"
import { Dialog } from "@/components/Dialog"
import type { Node } from "@/lib/api"
import { countryCoordinates } from "@/lib/geo-limit"

type MapLocation = {
  code: string
  label: string
  left: number
  top: number
  nodes: Node[]
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "region" })
  } catch {
    return null
  }
})()

export function NodeMapDialog({ nodes, open, onClose }: { nodes: Node[]; open: boolean; onClose: () => void }) {
  const [active, setActive] = useState<string | null>(null)
  const online = nodes.filter((node) => node.online)
  const locations = useMemo(() => {
    const grouped = new Map<string, Node[]>()
    online.forEach((node) => {
      const code = node.country.trim().toUpperCase()
      if (!countryCoordinates[code]) return
      grouped.set(code, [...(grouped.get(code) ?? []), node])
    })
    return [...grouped].map<MapLocation>(([code, countryNodes]) => {
      const coordinate = countryCoordinates[code]
      return {
        code,
        label: regionNames?.of(code) ?? coordinate.name,
        left: ((coordinate.lng + 180) / 360) * 100,
        top: ((90 - coordinate.lat) / 180) * 100,
        nodes: countryNodes,
      }
    })
  }, [online])
  const unknown = online.length - locations.reduce((total, location) => total + location.nodes.length, 0)

  return (
    <Dialog open={open} title="节点地图" description="当前在线节点的地理位置分布" onClose={onClose} className="probe-map-dialog">
      {locations.length ? (
        <div className="probe-map" style={{ backgroundImage: `url(${worldMapUrl})` }}>
          {locations.map((location) => {
            const selected = active === location.code
            const summary = `${location.label}，${location.nodes.length} 台：${location.nodes.map((node) => node.name).join("、")}`
            return (
              <button
                type="button"
                className="probe-map__point"
                style={{ left: `${location.left}%`, top: `${location.top}%`, "--map-point-size": `${Math.min(10, 4 + location.nodes.length)}px` } as React.CSSProperties}
                aria-label={summary}
                aria-expanded={selected}
                title={summary}
                onClick={() => setActive((current) => current === location.code ? null : location.code)}
                key={location.code}
              >
                <span />
                {selected && <strong role="status">{location.label}<small>{location.nodes.map((node) => node.name).join("、")}</small></strong>}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="dashboard-empty probe-map__empty">暂无在线节点位置</div>
      )}
      <div className="probe-map__summary">
        <span>{online.length} 台在线</span><span>{locations.length} 个地区</span>{unknown > 0 && <span>{unknown} 台位置未知</span>}
      </div>
    </Dialog>
  )
}
