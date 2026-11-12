/**
 * When the island exists.
 *
 * The island is a window of its own, so it must not outlive OpenCode: when
 * the app's last window closes, the island goes with it. It comes back when
 * the app opens a new window.
 */
export function islandShouldExist(openWindows: number): boolean {
  return openWindows > 0
}
