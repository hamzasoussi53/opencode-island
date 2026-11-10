import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react"
import {
  CursorClick,
  DotsSixVertical,
  ListDashes,
  Monitor,
  Moon,
  Sun,
} from "@phosphor-icons/react"
import type { IslandMessage, PermissionDecision, SessionView } from "../../../state"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

const EMPTY: IslandMessage = { sessions: [], working: 0, waiting: 0, open: false }

type Theme = "light" | "dark" | "system"

function elapsed(ms: number) {
  if (!ms || ms < 0) return ""
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

function count(n: number) {
  if (!n) return "0"
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function money(n: number) {
  if (!n) return ""
  return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`
}

function label(session: SessionView) {
  return session.permission
    ? `${session.permission.action} needs approval`
    : session.title || "Untitled session"
}

/** The closed tab is a spine: ten words is already a long one. */
function trim(text: string, max: number) {
  const words = text.trim().split(/\s+/)
  return words.length > max ? `${words.slice(0, max).join(" ")}…` : text
}

function latestOf(sessions: SessionView[]) {
  let latest: SessionView | undefined
  for (const session of sessions) {
    if (session.status === "idle" && !session.permission) continue
    if (!latest || session.updated > latest.updated) latest = session
  }
  return latest
}

/** Running sessions only, each followed by its subagents. */
function rowsOf(sessions: SessionView[]) {
  const active = sessions.filter((session) => session.status !== "idle" || session.permission)
  const known = new Set(active.map((session) => session.id))
  const children = new Map<string, SessionView[]>()
  const roots: SessionView[] = []

  for (const session of active) {
    if (session.parentID && known.has(session.parentID)) {
      const list = children.get(session.parentID) ?? []
      list.push(session)
      children.set(session.parentID, list)
    } else {
      roots.push(session)
    }
  }

  const rows: { session: SessionView; sub: boolean }[] = []
  for (const root of roots) {
    rows.push({ session: root, sub: false })
    for (const child of children.get(root.id) ?? []) rows.push({ session: child, sub: true })
  }
  return rows
}

export function Island() {
  const [state, setState] = useState<IslandMessage>(EMPTY)
  const [theme, setTheme] = useState<Theme>("dark")
  const [clickThrough, setClickThrough] = useState(false)
  const [showLatest, setShowLatest] = useState(false)
  const [systemDark, setSystemDark] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [hoverHandle, setHoverHandle] = useState(false)

  const shell = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLDivElement>(null)
  const pressY = useRef<number | null>(null)
  const moved = useRef(false)
  const lastSize = useRef("")

  const { sessions, working, waiting, open } = state

  useEffect(() => {
    window.island.onState(setState)
    window.island.ready()
  }, [])

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(query.matches)
    onChange()
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  // The tab has no clock, so only tick while the list is open.
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open])

  // The window is sized to the page; report every content change.
  useLayoutEffect(() => {
    const element = shell.current
    if (!element) return
    const report = () => {
      const rect = element.getBoundingClientRect()
      const width = Math.ceil(rect.width)
      const height = Math.ceil(rect.height)
      const next = `${width}x${height}`
      if (next === lastSize.current) return
      lastSize.current = next
      window.island.size(width, height)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Press and move on the closed tab to slide it along the edge.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (pressY.current !== null && Math.abs(event.screenY - pressY.current) > 3) {
        moved.current = true
      }
    }
    const onUp = () => {
      if (pressY.current === null) return
      pressY.current = null
      window.island.dragEnd()
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [])

  const ignore = clickThrough && !open && !hoverHandle

  useEffect(() => {
    window.island.ignore(ignore)
  }, [ignore])

  // With clicks ignored the page still gets forwarded moves, so hovering the
  // grip can take the window out of click-through for the click that opens it.
  useEffect(() => {
    if (!clickThrough || open) {
      setHoverHandle(false)
      return
    }
    const onMove = (event: MouseEvent) => {
      const element = handle.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      setHoverHandle(
        event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      )
    }
    document.addEventListener("mousemove", onMove)
    return () => document.removeEventListener("mousemove", onMove)
  }, [clickThrough, open])

  const onMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0 || open) return
    pressY.current = event.screenY
    moved.current = false
    window.island.dragStart()
  }

  const onClick = (event: ReactMouseEvent) => {
    if (moved.current) {
      moved.current = false
      return
    }
    if ((event.target as HTMLElement).closest("button, [data-row]")) return
    window.island.toggle()
  }

  const reply = (decision: PermissionDecision) => {
    const pending = sessions.find((session) => session.permission)?.permission
    if (pending) window.island.reply({ sessionID: pending.sessionID, requestID: pending.id, decision })
  }

  const alert = waiting > 0
  const muted = alert ? "text-warning-foreground/70" : "text-muted-foreground"
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme

  const what = alert
    ? `${waiting} approval${waiting === 1 ? "" : "s"} needed`
    : working > 0
      ? `${working} agent${working === 1 ? "" : "s"} working`
      : sessions.length
        ? "Idle"
        : "No sessions"

  const latest = latestOf(sessions)
  const work = showLatest && !alert ? latest : undefined
  const rows = rowsOf(sessions)
  const pending = sessions.find((session) => session.permission)?.permission
  const totalTokens = sessions.reduce((sum, session) => sum + (session.tokens || 0), 0)
  const totalCost = sessions.reduce((sum, session) => sum + (session.cost || 0), 0)

  const dot = alert ? "bg-warning-foreground" : working > 0 ? "bg-success" : "bg-muted-foreground"

  return (
    <div
      ref={shell}
      data-theme={resolved}
      data-waiting={alert}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden rounded-l-[18px] border transition-colors duration-300",
        alert
          ? "border-warning bg-warning text-warning-foreground"
          : "border-border bg-background text-foreground",
        open ? "w-[420px]" : "max-h-[380px] w-9",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-[3px] transition-colors duration-300",
          alert ? "bg-warning-foreground/25" : working > 0 ? "bg-success" : "bg-transparent",
        )}
      />

      {open ? (
        <div className="w-full">
          <div className={cn("flex items-center gap-2 border-b px-4 py-2 text-xs", muted)}>
            <span className={cn("font-semibold", alert ? "text-warning-foreground" : "text-foreground")}>
              {what}
            </span>
            <span className="flex-1" />
            {totalTokens ? <span className="tabular-nums">{count(totalTokens)} tokens</span> : null}
            {totalCost ? <span className="tabular-nums">{money(totalCost)}</span> : null}
          </div>

          <div className="max-h-[280px] overflow-y-auto py-1">
            {rows.length ? (
              rows.map(({ session, sub }) => (
                <Row key={session.id} session={session} sub={sub} now={now} alert={alert} />
              ))
            ) : (
              <p className={cn("px-4 py-2.5 text-xs", muted)}>Nothing running</p>
            )}
          </div>

          {pending ? (
            <div className="border-t px-4 py-3">
              <p className="mb-0.5 text-[12.5px]">{pending.action}</p>
              <p className={cn("mb-2.5 truncate font-mono text-[11.5px]", muted)}>
                {pending.resources.join("   ") || pending.message || ""}
              </p>
              <div className="flex gap-2">
                <Button size="xs" onClick={() => reply("once")}>
                  Allow once
                </Button>
                <Button size="xs" variant="secondary" onClick={() => reply("always")}>
                  Always allow
                </Button>
                <Button size="xs" variant="ghost" onClick={() => reply("reject")}>
                  Deny
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-1 border-t px-2 py-1.5">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={theme}
              onValueChange={(value) => {
                if (value) setTheme(value as Theme)
              }}
              aria-label="Theme"
            >
              <ToggleGroupItem value="light" aria-label="Light" title="Light">
                <Sun weight="duotone" />
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="Dark" title="Dark">
                <Moon weight="duotone" />
              </ToggleGroupItem>
              <ToggleGroupItem value="system" aria-label="System" title="System">
                <Monitor weight="duotone" />
              </ToggleGroupItem>
            </ToggleGroup>

            <span className="flex-1" />

            <Toggle
              size="sm"
              variant="outline"
              pressed={clickThrough}
              onPressedChange={setClickThrough}
              aria-label="Click through"
              title="Click through"
            >
              <CursorClick weight="duotone" />
            </Toggle>
            <Toggle
              size="sm"
              variant="outline"
              pressed={showLatest}
              onPressedChange={setShowLatest}
              aria-label="Show latest work"
              title="Show latest work"
            >
              <ListDashes weight="duotone" />
            </Toggle>
          </div>
        </div>
      ) : (
        <div className="flex w-full items-center gap-2 py-2.5 [writing-mode:vertical-rl]">
          <div
            ref={handle}
            className={cn("flex size-5 shrink-0 items-center justify-center rounded-sm", muted)}
          >
            <DotsSixVertical size={14} weight="duotone" />
          </div>
          <span className={cn("size-[7px] shrink-0 rounded-full transition-colors duration-300", dot)} />
          {work ? (
            <>
              <span className="text-[12.5px] font-medium">{trim(work.title || "Untitled session", 10)}</span>
              {work.tool ? <span className={cn("text-xs", muted)}>{work.tool}</span> : null}
            </>
          ) : (
            <span className="text-[12.5px] font-medium">{what}</span>
          )}
        </div>
      )}
    </div>
  )
}

function Row({
  session,
  sub,
  now,
  alert,
}: {
  session: SessionView
  sub: boolean
  now: number
  alert: boolean
}) {
  const waiting = Boolean(session.permission)
  const muted = alert ? "text-warning-foreground/70" : "text-muted-foreground"

  return (
    <div
      data-row
      className={cn("grid grid-cols-[8px_1fr_auto] items-center gap-2.5 px-4 py-1.5", sub && "pl-9")}
    >
      <span
        className={cn(
          "size-[7px] rounded-full",
          waiting || session.status === "retry" ? "bg-warning" : "bg-success",
        )}
      />
      <span className={cn("truncate text-[12.5px]", sub && "text-xs", sub && muted)}>
        {!sub && session.agent ? <span className={cn("mr-1.5", muted)}>{session.agent}</span> : null}
        {label(session)}
        {session.tool ? <span className={cn("ml-1.5", muted)}>{session.tool}</span> : null}
      </span>
      <span className={cn("text-[11.5px] tabular-nums", muted)}>
        {elapsed(now - (sub ? session.updated : session.created))}
      </span>
    </div>
  )
}
