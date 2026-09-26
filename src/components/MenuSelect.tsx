import { Check, ChevronDown, type LucideIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

export type MenuOption<T extends string> = {
  value: T
  label: string
  count?: number
}

export function MenuSelect<T extends string>({ value, options, label, icon: Icon, className, onChange }: {
  value: T
  options: MenuOption<T>[]
  label: string
  icon: LucideIcon
  className?: string
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as globalThis.Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", dismiss)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", dismiss)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  return (
    <div className={cn("menu-select", className)} ref={root}>
      <button
        type="button"
        className="menu-select__trigger"
        aria-label={`${label}：${selected?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon className="menu-select__leading" aria-hidden="true" />
        <span>{selected?.label}</span>
        <ChevronDown className="menu-select__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu-select__menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.count === undefined ? null : <small>{option.count}</small>}
              <Check aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
