import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

let flagAssetsPromise: Promise<typeof import("@/lib/flag-assets")> | null = null

function normalizeCountryCode(raw: string) {
  const code = raw.trim().toLowerCase()
  return /^[a-z]{2}$/.test(code) ? code : "xx"
}

export function ServerFlag({ code, className }: { code: string; className?: string }) {
  const normalized = normalizeCountryCode(code)
  const [flagUrl, setFlagUrl] = useState("")

  useEffect(() => {
    let active = true
    flagAssetsPromise ||= import("@/lib/flag-assets")
    void flagAssetsPromise.then(({ getFlagUrl }) => {
      if (active) setFlagUrl(getFlagUrl(normalized))
    })
    return () => {
      active = false
    }
  }, [normalized])

  return (
    <span className={cn("server-flag", className)} aria-label={normalized.toUpperCase()}>
      {flagUrl && <span className="server-flag__image" style={{ backgroundImage: `url("${flagUrl}")` }} />}
    </span>
  )
}
