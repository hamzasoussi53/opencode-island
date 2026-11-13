import type { IslandMessage, PermissionDecision, QueuedPrompt, SessionPicks } from "../../state"

declare global {
  interface Window {
    island: {
      ready: () => void
      size: (width: number, height: number) => void
      toggle: () => void
      reply: (reply: { sessionID: string; requestID: string; decision: PermissionDecision }) => void
      prompt: (request: {
        sessionID: string
        text: string
        delivery: "steer" | "queue"
      }) => Promise<{ ok: boolean; error?: string }>
      queued: (sessionID: string) => Promise<QueuedPrompt[]>
      cancel: (request: { sessionID: string; inboxID: string }) => void
      dragStart: () => void
      dragEnd: () => void
      ignore: (ignore: boolean) => void
      resizeStart: () => void
      resize: (screenY: number) => void
      resizeEnd: () => void
      drawerSize: (size: { width: number; height: number }) => void
      openApp: () => void
      quit: () => void
      screen: () => Promise<{ width: number; height: number }>
      onState: (handler: (state: IslandMessage) => void) => void
      onPicks: (handler: (picks: SessionPicks) => void) => void
    }
  }
}

export {}
