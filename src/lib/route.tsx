import { useEffect, useState, type ComponentProps } from "react"

export type AppRoute = { kind: "home" } | { kind: "network" } | { kind: "server"; key: string } | { kind: "missing" }

const read = (): AppRoute => {
  if (location.pathname === "/" || location.pathname === "") return { kind: "home" }
  if (/^\/network\/?$/.test(location.pathname)) return { kind: "network" }
  const match = location.pathname.match(/^\/server\/([a-f0-9]{8})\/?$/)
  return match ? { kind: "server", key: match[1] } : { kind: "missing" }
}

/**
 * The public routes are exact. The hub serves index.html for unknown paths, so a
 * reload or shared detail link still reaches this client-side resolver.
 */
export function useRoute() {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const sync = () => setRoute(read())
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  return route
}

/** Announced as a popstate, so `useRoute` hears it the way it hears back. */
function navigate(href: string) {
  history.pushState({}, "", href)
  dispatchEvent(new PopStateEvent("popstate"))
  scrollTo(0, 0)
}

/**
 * A real anchor, so a modified or middle click still opens a new tab; only a plain
 * click is kept in the page.
 */
export function Link({ href, onClick, ...props }: ComponentProps<"a"> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(href)
      }}
      {...props}
    />
  )
}
