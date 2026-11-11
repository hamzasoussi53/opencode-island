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
import { ThinkingOrb } from "thinking-orbs"
import type { IslandMessage, PermissionDecision, SessionView } from "../../../state"
import { barOrbState, orbState } from "../../../orb"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"

const EMPTY: IslandMessage = { sessions: [], working: 0, waiting: 0, open: false }

type Theme = "light" | "dark" | "system"

/** The appearance button cycles through the three, one click each. */
const THEMES: Theme[] = ["light", "dark", "system"]

function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
}

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
  const [showLatest, setShowLatest] = useState(true)
  const [systemDark, setSystemDark] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [hoverHandle, setHoverHandle] = useState(false)
  /** The height the user asked for, as a share of the screen. Null until set. */
  const [share, setShare] = useState<number | null>(null)
  const [screen, setScreen] = useState({ width: 1920, height: 1200 })

  const shell = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLDivElement>(null)
  const pressY = useRef<number | null>(null)
  const moved = useRef(false)
  /** True while the bottom edge of the closed bar is being dragged. */
  const resizing = useRef(false)
  /** True just after a resize, so the release does not open the island. */
  const resized = useRef(false)
  const lastSize = useRef("")

  const { sessions, working, waiting, open } = state

  useEffect(() => {
    window.island.onState(setState)
    window.island.ready()
    void window.island.screen().then(setScreen)
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

  // The window is sized to the page; report every content change. A share of
  // the screen wins over the content height, so the panel can be a set length.
  useLayoutEffect(() => {
    const element = shell.current
    if (!element) return
    const report = () => {
      // While the bar is resized the drag owns the height.
      if (resizing.current) return
      const rect = element.getBoundingClientRect()
      const width = Math.ceil(rect.width)
      const height = Math.ceil(rect.height)
      // The share is the length of the closed tab, so the panel stays as it is.
      const wanted = share && !open ? Math.round((screen.height * share) / 100) : height
      const next = `${width}x${wanted}`
      if (next === lastSize.current) return
      lastSize.current = next
      window.island.size(width, wanted)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [share, open, screen])

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

  // Dragging the bottom edge of the closed bar makes it longer or shorter.
  // The window does the arithmetic, so the bottom edge follows the mouse.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!resizing.current) return
      window.island.resize(event.screenY)
    }
    const onUp = () => {
      if (!resizing.current) return
      resizing.current = false
      resized.current = true
      window.setTimeout(() => {
        resized.current = false
      }, 500)
      // The window knows the length the drag asked for; keep it.
      const next = Math.round((window.innerHeight / screen.height) * 100)
      setShare(Math.min(90, Math.max(10, next)))
      window.island.resizeEnd()
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [screen.height])

  // While the bar is being resized the window tells us how long it is now.
  useEffect(() => {
    const sync = () => {
      if (!resizing.current) return
      const next = Math.round((window.innerHeight / screen.height) * 100)
      setShare((current) => (current === next ? current : Math.min(90, Math.max(10, next))))
    }
    window.addEventListener("resize", sync)
    return () => window.removeEventListener("resize", sync)
  }, [screen.height])

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
    // A resize that ended away from the handle still lands as a click.
    if (resized.current) {
      resized.current = false
      return
    }
    if ((event.target as HTMLElement).closest("button, [data-row], [data-resize]")) return
    window.island.toggle()
  }

  // The bottom edge of the closed bar is its length handle.
  const onResizeDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    resizing.current = true
    window.island.resizeStart()
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

  const active = latestOf(sessions)
  const work = showLatest && !alert ? active : undefined
  const barOrb = barOrbState(active, alert)
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
        "relative flex shrink-0 flex-col overflow-hidden rounded-l-lg rounded-r-none border transition-colors duration-300",
        alert
          ? "border-warning bg-warning text-warning-foreground"
          : "border-border bg-background text-foreground",
        open ? "w-[420px]" : share ? "h-full w-9" : "h-[240px] w-9",
      )}
    >
      {open ? (
        <div className="flex w-full flex-col">
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
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setTheme(nextTheme(theme))}
              aria-label={`Appearance: ${theme}. Click for ${nextTheme(theme)}.`}
              title={`Appearance: ${theme}`}
              className={cn(alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10")}
            >
              {theme === "light" ? (
                <Sun weight="duotone" />
              ) : theme === "dark" ? (
                <Moon weight="duotone" />
              ) : (
                <Monitor weight="duotone" />
              )}
            </Button>

            <span className="flex-1" />

            <Toggle
              size="sm"
              variant="outline"
              pressed={clickThrough}
              onPressedChange={setClickThrough}
              aria-label="Click through"
              title="Click through"
              className={cn(alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10")}
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
              className={cn(alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10")}
            >
              <ListDashes weight="duotone" />
            </Toggle>
          </div>
        </div>
      ) : (
        <div className="flex h-full w-full items-center gap-2 px-2 pb-5 pt-3 [writing-mode:vertical-rl]">
          <div
            ref={handle}
            className={cn("flex size-5 shrink-0 items-center justify-center rounded-sm", muted)}
          >
            <DotsSixVertical size={14} weight="duotone" />
          </div>
          {/* The slot keeps its size, so the bar does not change length. */}
          <span className="flex size-5 shrink-0 items-center justify-center">
            {barOrb ? (
              <ThinkingOrb state={barOrb} size={20} className="shrink-0" />
            ) : (
              <span className={cn("size-[7px] shrink-0 rounded-full transition-colors duration-300", dot)} />
            )}
          </span>
          {work ? (
            <>
              {/* The words fill the bar and are cut, never the bar. The newest
                  ones stay in sight: the column ends at the bottom of it. */}
              <span className="flex min-h-0 flex-1 justify-end overflow-hidden text-center">
                <span className="shrink-0 whitespace-nowrap text-[12.5px] font-medium">
                  {work.stream || trim(work.title || "Untitled session", 10)}
                </span>
              </span>
              {work.tool ? <span className={cn("shrink-0 text-xs", muted)}>{work.tool}</span> : null}
            </>
          ) : (
            <span className="text-[12.5px] font-medium">{what}</span>
          )}
        </div>
      )}

      {open ? null : (
        <div
          data-resize
          onMouseDown={onResizeDown}
          title="Drag to change the length"
          className={cn(
            "absolute inset-x-0 bottom-0 flex h-4 cursor-ns-resize items-center justify-center",
            muted,
          )}
        >
          <DotsSixVertical size={14} weight="duotone" className="rotate-90" />
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
  const orb = orbState(session)

  return (
    <div
      data-row
      className={cn("grid grid-cols-[20px_1fr_auto] items-start gap-2.5 px-4 py-1.5", sub && "pl-9")}
    >
      {orb ? (
        // A subagent row prints no phase, so its orb is the only word on it.
        <ThinkingOrb
          state={orb}
          size={20}
          aria-hidden={sub ? undefined : "true"}
          className="shrink-0"
        />
      ) : (
        <span
          className={cn(
            "mt-1 size-[7px] shrink-0 justify-self-center rounded-full",
            waiting ? "bg-warning" : "bg-success",
          )}
        />
      )}
      <div className="min-w-0">
        <div className={cn("truncate text-[12.5px]", sub && "text-xs", sub && muted)}>
          {!sub && session.agent ? <span className={cn("mr-1.5", muted)}>{session.agent}</span> : null}
          {!sub && session.phase && session.phase !== "idle" ? (
            <span className={cn("mr-1.5 text-[11px] uppercase", muted)}>{session.phase}</span>
          ) : null}
          {label(session)}
          {session.tool ? <span className={cn("ml-1.5", muted)}>{session.tool}</span> : null}
        </div>
        {session.stream ? (
          <div className={cn("truncate text-[11.5px]", muted)}>{session.stream}</div>
        ) : null}
      </div>
      <span className={cn("text-[11.5px] tabular-nums", muted)}>
        {elapsed(now - (sub ? session.updated : session.created))}
      </span>
    </div>
  )
}
