/**
 * When the island exists.
 *
 * The island is a window of its own, so it must not outlive OpenCode: when
 * the app's last window closes, the island goes with it. It comes back when
 * the app opens a new window.
 *
 * It also stays away while the user has turned it off, and comes back when
 * they turn it on again.
 */
export function islandShouldExist(openWindows: number, enabled: boolean): boolean {
  return openWindows > 0 && enabled
}
