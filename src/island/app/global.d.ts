import type { IslandMessage, PermissionDecision } from "../../state"

declare global {
  interface Window {
    island: {
      ready: () => void
      size: (width: number, height: number) => void
      toggle: () => void
      reply: (reply: { sessionID: string; requestID: string; decision: PermissionDecision }) => void
      dragStart: () => void
      dragEnd: () => void
      ignore: (ignore: boolean) => void
      onState: (handler: (state: IslandMessage) => void) => void
    }
  }
}

export {}
