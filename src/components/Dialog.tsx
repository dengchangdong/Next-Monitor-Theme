import { X } from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Dialog({ open, title, description, onClose, className, children }: {
  open: boolean
  title: string
  description: string
  onClose: () => void
  className?: string
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
      className={cn("dashboard-dialog", className)}
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
        <button type="button" aria-label="关闭" title="关闭" onClick={onClose}><X /></button>
      </div>
      {children}
    </dialog>
  )
}
