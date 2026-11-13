import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react"
import {
  CaretDown,
  CursorClick,
  DotsSixVertical,
  ListDashes,
  Monitor,
  Moon,
  Power,
  Sun,
} from "@phosphor-icons/react"
import { ThinkingOrb } from "thinking-orbs"
import type {
  IslandMessage,
  PermissionDecision,
  PlanStep,
  QueuedPrompt,
  SessionPicks,
  SessionView,
} from "../../../state"
import { barOrbState, orbState } from "../../../orb"
import { planWindow } from "../../../plan"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"

const EMPTY: IslandMessage = { sessions: [], working: 0, waiting: 0, open: false }

/** Where the length of the closed tab is kept, so it survives a restart. */
const SHARE_KEY = "opencode-island:share"

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

/** The last segment of a project path, which is the project's own name. */
function lastSegment(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? ""
}

/** OpenCode's own mark, taken from opencode.ai. */
function OpenCodeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 300" className={className} fill="none" aria-hidden="true">
      <path d="M180 240H60V120H180V240Z" fill="currentColor" />
      <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

/** One step of the plan: its number, and a dot that says where it stands. */
function StepMark({ step, across }: { step: PlanStep; across?: boolean }) {
  return (
    <span
      title={step.title}
      className={cn(
        "flex items-center gap-1 text-[10px] leading-none tabular-nums",
        across ? "flex-col-reverse" : "flex-row",
      )}
    >
      <span className="text-muted-foreground">{step.n}</span>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          step.state === "done" && "bg-success",
          step.state === "working" && "step-live bg-warning",
          step.state === "waiting" && "bg-waiting",
          step.state === "failed" && "bg-destructive",
        )}
      />
    </span>
  )
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
  /** The screen size turns the kept share into a length, so nothing is sized until it is in. */
  const [ready, setReady] = useState(false)
  /** The session the user picked to send to, so the choice outlives the drawer. */
  const [picked, setPicked] = useState<string | null>(null)
  /** The tabs open in OpenCode, on their own channel: they never ride on a message. */
  const [picks, setPicks] = useState<SessionPicks>([])
  /** True while the target chip's session list is open. */
  const [picking, setPicking] = useState(false)

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
    window.island.onPicks(setPicks)
    window.island.ready()
    void window.island
      .screen()
      .then((size) => {
        setScreen(size)
        // The length the user set last time, so the bar does not start over.
        const saved = Number(localStorage.getItem(SHARE_KEY))
        if (saved >= 10 && saved <= 90) setShare(saved)
      })
      .catch(() => undefined)
      .finally(() => setReady(true))
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

  // A list left open when the drawer closed is not open when it comes back.
  useEffect(() => {
    if (!open) setPicking(false)
  }, [open])

  // The window is sized to the page; report every content change. A share of
  // the screen wins over the content height, so the panel can be a set length.
  useLayoutEffect(() => {
    const element = shell.current
    if (!element || !ready) return
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
  }, [share, open, screen, ready])

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
      const clamped = Math.min(90, Math.max(10, next))
      setShare(clamped)
      localStorage.setItem(SHARE_KEY, String(clamped))
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
    if ((event.target as HTMLElement).closest("button, [data-row], [data-composer], [data-resize]"))
      return
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

  // Chromium paints its canvas with the page's colour scheme wherever the page
  // paints nothing, and the tab's rounded corners are exactly such a place:
  // without this they showed as white corners on the screen edge.
  useEffect(() => {
    document.documentElement.style.colorScheme = resolved
  }, [resolved])

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
  // The chip names the session in hand, which is the picked one or the one
  // the bar is already showing. A tab open in OpenCode may have no live row,
  // so the picked id is looked up in the picks first.
  const chosen = picked
    ? picks.find((pick) => pick.id === picked) ?? sessions.find((session) => session.id === picked)
    : undefined
  const target = chosen ?? active
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
                <Row
                  key={session.id}
                  session={session}
                  sub={sub}
                  now={now}
                  alert={alert}
                  selected={picked === session.id}
                  onSelect={sub ? undefined : setPicked}
                />
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

          <Composer
            target={target}
            picks={picks}
            alert={alert}
            picking={picking}
            onPick={() => setPicking((open) => !open)}
            onChoose={(id) => {
              setPicked(id)
              setPicking(false)
            }}
          />

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

            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => window.island.openApp()}
              aria-label="Open OpenCode"
              title="Open OpenCode"
              className={cn(alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10")}
            >
              <OpenCodeMark className="h-4 w-[13px]" />
            </Button>

            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => window.island.quit()}
              aria-label="Close OpenCode and the island"
              title="Close OpenCode and the island"
              className={cn(
                "text-destructive hover:bg-destructive/15 hover:text-destructive",
                alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10",
              )}
            >
              <Power weight="duotone" />
            </Button>

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
        <div className="flex h-full w-full items-center gap-2 px-2 pb-6 pt-3 [writing-mode:vertical-rl]">
          <div
            ref={handle}
            className={cn("flex size-5 shrink-0 items-center justify-center rounded-sm", muted)}
          >
            <DotsSixVertical size={14} weight="duotone" />
          </div>
          {/* How many agents are working, as a number under the grip. */}
          {working > 0 ? (
            <span
              key={working}
              className="count-pop shrink-0 text-[13px] font-semibold tabular-nums"
            >
              {working}
            </span>
          ) : null}
          {/* The slot keeps its size, so the bar does not change length. */}
          <span className="flex size-5 shrink-0 items-center justify-center">
            {barOrb ? (
              <ThinkingOrb state={barOrb} size={20} className="shrink-0" />
            ) : (
              <span className={cn("size-[7px] shrink-0 rounded-full transition-colors duration-300", dot)} />
            )}
          </span>
          {/* The steps around the one in hand, in order. */}
          {active?.plan?.length ? (
            <span className="flex shrink-0 flex-row items-center gap-1.5">
              {planWindow(active.plan).map((step) => (
                <StepMark key={step.n} step={step} across />
              ))}
            </span>
          ) : null}
          {work ? (
            <>
              {/* The words fill the bar and are cut, never the bar. They start
                  under the dot and run down, so the bar keeps its length. */}
              <span className="flex min-h-0 flex-1 justify-start overflow-hidden text-center">
                <span className="shrink-0 whitespace-nowrap text-[12.5px] font-medium">
                  {work.stream || trim(work.title || "Untitled session", 10)}
                </span>
              </span>
              {work.tool ? <span className={cn("shrink-0 text-xs", muted)}>{work.tool}</span> : null}
            </>
          ) : (
            /* The filler keeps the words under the dot and the buttons at the foot. */
            <span className="flex min-h-0 flex-1 justify-start overflow-hidden">
              <span className="shrink-0 whitespace-nowrap text-[12.5px] font-medium">{what}</span>
            </span>
          )}
          {/* The two actions sit at the foot of the bar, above the resize grip.
              The bar is written vertically, so a row runs down it. */}
          <span className="flex shrink-0 flex-row items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => window.island.openApp()}
              aria-label="Open OpenCode"
              title="Open OpenCode"
              className={cn(
                "size-5",
                alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10",
              )}
            >
              <OpenCodeMark className="h-3.5 w-[11px]" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => window.island.quit()}
              aria-label="Close OpenCode and the island"
              title="Close OpenCode and the island"
              className={cn(
                "size-5 text-destructive hover:bg-destructive/15 hover:text-destructive",
                alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10",
              )}
            >
              <Power size={12} weight="duotone" />
            </Button>
          </span>
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
  selected,
  onSelect,
}: {
  session: SessionView
  sub: boolean
  now: number
  alert: boolean
  selected: boolean
  /** Absent on a subagent row: a prompt goes to the session, not its helper. */
  onSelect?: (id: string) => void
}) {
  const waiting = Boolean(session.permission)
  const muted = alert ? "text-warning-foreground/70" : "text-muted-foreground"
  const orb = orbState(session)

  return (
    <div
      data-row
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      onClick={onSelect ? () => onSelect(session.id) : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              onSelect(session.id)
            }
          : undefined
      }
      className={cn(
        "grid grid-cols-[20px_1fr_auto] items-start gap-2.5 px-4 py-1.5",
        onSelect && "cursor-pointer",
        selected && "bg-accent/50",
        sub && "pl-9",
      )}
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
        {session.plan?.length ? (
          // A long plan wraps onto a second line rather than running over the
          // time on the right.
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {session.plan.map((step) => (
              <StepMark key={step.n} step={step} />
            ))}
            <span className={cn("text-[10.5px] tabular-nums", muted)}>
              {session.plan.filter((step) => step.state === "done").length}/{session.plan.length}
            </span>
          </div>
        ) : null}
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

/** The queue as the server answered it, or why it could not be read. */
type Queue =
  | { state: "reading" }
  | { state: "ready"; items: QueuedPrompt[] }
  | { state: "failed" }

/**
 * The tabs open in OpenCode, last opened first, each named by its title, its
 * agent and its project. A running one carries a dot so it is never taken for
 * a finished tab.
 */
function Picker({
  picks,
  target,
  onChoose,
}: {
  picks: SessionPicks
  target: string | undefined
  onChoose: (id: string) => void
}) {
  return (
    <div
      role="listbox"
      aria-label="Sessions open in OpenCode"
      onKeyDown={(event) => {
        // A listbox moves with the arrows, not only with Tab.
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        event.preventDefault()
        const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='option']")]
        const at = options.indexOf(document.activeElement as HTMLElement)
        options[at + (event.key === "ArrowDown" ? 1 : -1)]?.focus()
      }}
      className="mb-1.5 max-h-[168px] overflow-y-auto rounded-md border bg-background p-1 text-foreground"
    >
      {picks.length ? (
        // The options are the listbox's own children, as ARIA requires.
        picks.map((pick) => {
          const running = pick.status === "busy" || pick.status === "retry"
          const project = lastSegment(pick.directory)
          return (
            <button
              key={pick.id}
              role="option"
              aria-selected={pick.id === target}
              onClick={() => onChoose(pick.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left",
                pick.id === target ? "bg-accent/50" : "hover:bg-accent/40",
              )}
            >
              <span
                aria-hidden="true"
                title={running ? "Running" : "Not running"}
                className={cn(
                  "size-[7px] shrink-0 rounded-full",
                  running ? "bg-success" : "bg-muted-foreground/40",
                )}
              />
              <span className="sr-only">{running ? "Running" : "Not running"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px]">
                  {pick.title || "Untitled session"}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {[pick.agent, project].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          )
        })
      ) : (
        <p className="px-1.5 py-1 text-[11.5px] text-muted-foreground">
          No sessions open in OpenCode
        </p>
      )}
    </div>
  )
}

/** One field, sent to the session the chip names. */
function Composer({
  target,
  picks,
  alert,
  picking,
  onPick,
  onChoose,
}: {
  target: { id: string; title: string } | undefined
  picks: SessionPicks
  alert: boolean
  picking: boolean
  onPick: () => void
  onChoose: (id: string) => void
}) {
  const [text, setText] = useState("")
  /** What went wrong with the last send, kept in the island where the user is. */
  const [error, setError] = useState("")
  const [menu, setMenu] = useState(false)
  const [queue, setQueue] = useState<Queue>({ state: "reading" })
  /** True between asking for a send and hearing back, so Enter cannot double it. */
  const sending = useRef(false)
  const targetID = target?.id
  // The chip names the session in hand, or says what it does when there is
  // none: a tab can still be picked when no session is running.
  const name = target ? target.title || "Untitled session" : "Pick a session"
  const label = target ? `Send to ${name}` : name

  // A failure belongs to the session it was about, not to the next one.
  useEffect(() => {
    setError("")
  }, [targetID])

  // The queue is asked of the server when the menu opens, never counted.
  useEffect(() => {
    if (!menu || !targetID) return
    let live = true
    setQueue({ state: "reading" })
    const queued = window.island.queued(targetID)
    queued
      .then((items) => {
        if (live) setQueue({ state: "ready", items })
      })
      .catch(() => {
        // An empty list would claim the queue is empty, which it may not be.
        if (live) setQueue({ state: "failed" })
      })
    return () => {
      live = false
    }
  }, [menu, targetID])

  const finish = (answer: { ok: boolean; error?: string }, body: string) => {
    if (!answer.ok) {
      // The text stays in the field, so the send can be tried again.
      setError(answer.error || "The prompt could not be sent")
      return
    }
    // Anything typed while the send was in flight is not thrown away.
    setText((current) => (current.trim() === body ? "" : current))
    setError("")
    setMenu(false)
    // The keyboard goes back to the app, so a stray Enter cannot send again.
    window.blur()
  }

  const send = async (delivery: "steer" | "queue") => {
    const body = text.trim()
    // An empty field sends nothing, and a send in flight is not sent twice.
    if (!body || !target || sending.current) return
    setError("")
    sending.current = true
    try {
      finish(await window.island.prompt({ sessionID: target.id, text: body, delivery }), body)
    } finally {
      sending.current = false
    }
  }

  const cancel = (inboxID: string) => {
    if (!target) return
    window.island.cancel({ sessionID: target.id, inboxID })
    // shortcut: the list trusts that the server took the cancel, because
    // window.island.cancel answers nothing; upgrade when it answers.
    setQueue((current) =>
      current.state === "ready"
        ? { state: "ready", items: current.items.filter((item) => item.id !== inboxID) }
        : current,
    )
  }

  return (
    <div data-composer className="border-t px-3 py-2">
      {/* The tabs open in OpenCode, above the chip: the composer keeps its
          place at the foot of the drawer whatever the list holds. */}
      {picking ? <Picker picks={picks} target={target?.id} onChoose={onChoose} /> : null}

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="xs"
          onClick={onPick}
          // A tab can be picked when no session is running, so the list stays
          // reachable as long as there are tabs to offer.
          disabled={!target && !picks.length}
          aria-haspopup="listbox"
          aria-expanded={picking}
          aria-label={label}
          title={label}
          className={cn(
            "max-w-[120px]",
            alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10",
          )}
        >
          <span className="truncate">{name}</span>
        </Button>

        <input
          className={cn(
            "composer-field h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "placeholder:text-muted-foreground disabled:opacity-50",
            alert && "border-warning-foreground/30 placeholder:text-warning-foreground/60",
          )}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            // A new attempt is not the last one's failure.
            if (error) setError("")
          }}
          onKeyDown={(event) => {
            // An Enter that closes an input method's composition is not a send.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            void send("steer")
          }}
          placeholder={target ? "Prompt" : "No session to send to"}
          aria-label="Prompt"
          disabled={!target}
          spellCheck={false}
          autoComplete="off"
        />

        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => setMenu((open) => !open)}
          disabled={!target}
          aria-label="Send options"
          aria-expanded={menu}
          title="Send options"
          className={cn(
            alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10",
          )}
        >
          <CaretDown weight="duotone" />
        </Button>
      </div>

      {error ? (
        <p className={cn("mt-1 text-[11px]", alert ? "text-warning-foreground" : "text-destructive")}>
          {error}
        </p>
      ) : null}

      {menu && target ? (
        // A surface of its own, so the menu reads the same on a warning drawer.
        <div className="mt-1.5 rounded-md border bg-background p-1.5 text-foreground">
          <div className="flex items-center gap-2 pb-1">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => void send("queue")}
              disabled={!text.trim()}
            >
              Queue
            </Button>
            <span className="text-[11px] text-muted-foreground">Send after the current turn</span>
          </div>
          {queue.state === "reading" ? (
            <p className="px-1 pt-1 text-[11px] text-muted-foreground">Reading the queue</p>
          ) : queue.state === "failed" ? (
            <p className="px-1 pt-1 text-[11px] text-muted-foreground">The queue could not be read</p>
          ) : queue.items.length ? (
            <ul className="flex flex-col">
              {queue.items.map((item) => (
                <li key={item.id} className="flex items-center gap-2 px-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{item.text}</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="h-5 px-1.5 text-[11px]"
                    onClick={() => cancel(item.id)}
                  >
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 pt-1 text-[11px] text-muted-foreground">Nothing queued</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
