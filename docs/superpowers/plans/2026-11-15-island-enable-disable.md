# The island can be turned off — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A switch in the island's bottom bar turns the island off, and an item in the OpenCode app menu turns it back on.

**Architecture:** The plugin's main half (`src/gui.tsx`) owns the island window and already destroys it when OpenCode's last window closes. The off state is one boolean in the app's own plugin storage (`ctx.storage.store`), so it survives a restart; "off" is that boolean being false, and `islandShouldExist` is the single rule that decides whether the window is created. The island page reaches the main half over the same IPC channel file it already uses, with one new message: `hide`.

**Tech Stack:** Electron, React 19 (the island page), Solid (the plugin), OpenCode's GUI plugin SDK (`@opencode/plugin/gui`, `@opencode/plugin/gui/main`), effect's `Schema`, `node:assert` in `scripts/check.ts`.

**Spec:** `docs/superpowers/specs/2026-11-15-island-enable-disable-design.md`

## Global Constraints

- "Off" means the island window is **destroyed**, not hidden: no renderer, no page, nothing on the screen.
- The plugin keeps following the app's server while the island is off.
- The off state lives in the app's plugin storage, so it survives a restart of OpenCode. The island's other switches stay remembered for the session only.
- The way back is an item in the OpenCode **app menu** (`menu: "app"`), labelled `Hide island` while the island is there and `Show island` while it is not.
- The island's own control is a plain **button** in the drawer's bottom bar, not a toggle: its off state is never on screen.
- No keybind, no tray icon, no command in the palette, no button in the closed tab.

## Review Focus

- OpenCode restarts while the island is off: the island must stay off, and the menu item must read `Show island`.
- The island is turned off while an approval is waiting: the island goes, nothing is left half-open, and the approval is answered in OpenCode.
- OpenCode's last window closes while the island is off, then a window opens again: no island is created until the menu says `Show island`.
- The island is turned off and then on again: it comes back as the closed tab, with the size and position it had.
- The island is turned off and on twice: one window, not two.

---

### Task 1: The rule that says whether the island exists

**Files:**
- Modify: `src/lifecycle.ts:8-10`
- Modify: `scripts/check.ts:540-542`

**Interfaces:**
- Consumes: nothing.
- Produces: `islandShouldExist(openWindows: number, enabled: boolean): boolean` — true only when OpenCode has a window of its own and the user has not turned the island off. `src/gui.tsx` calls it in Task 2.

- [ ] **Step 1: Write the failing test**

In `scripts/check.ts`, replace the three `islandShouldExist` assertions with:

```ts
assert.equal(islandShouldExist(0, true), false)
assert.equal(islandShouldExist(1, true), true)
assert.equal(islandShouldExist(3, true), true)
assert.equal(islandShouldExist(1, false), false)
assert.equal(islandShouldExist(3, false), false)
```

- [ ] **Step 2: Run the check to see it fail**

Run: `npm run check`
Expected: FAIL — `islandShouldExist` ignores its second argument, so `islandShouldExist(1, false)` is `true` and the assertion fails.

- [ ] **Step 3: Change the rule**

In `src/lifecycle.ts`, the function takes the flag and the doc comment says the island exists while OpenCode has a window **and** the user has not turned it off:

```ts
export function islandShouldExist(openWindows: number, enabled: boolean): boolean {
  return openWindows > 0 && enabled
}
```

- [ ] **Step 4: Run the check to see it pass**

Run: `npm run check`
Expected: PASS, no output.

- [ ] **Step 5: Commit**

```bash
git add src/lifecycle.ts scripts/check.ts
git commit -m "feat: the island exists only while it is turned on"
```

---

### Task 2: The switch in the island, and the way back in the app menu

**Files:**
- Modify: `src/window.ts` — the `IslandWindowOptions` interface (add `onHide`), a new `onHide` handler, `ipcMain.on` / `removeListener` for the channel.
- Modify: `src/island/preload.cjs` — the `hide` method on the bridge.
- Modify: `src/island/app/global.d.ts` — the `hide` method on the `window.island` type.
- Modify: `src/gui.tsx` — the stored flag, the menu item, `sync()` gated on the flag, the `onHide` handler.
- Modify: `src/island/app/components/island.tsx` — the button in the drawer's bottom bar.
- Modify: `package.json` — the `effect` dependency.

**Interfaces:**
- Consumes: `islandShouldExist(openWindows: number, enabled: boolean): boolean` from Task 1.
- Produces: the IPC message `opencode-island:hide`, sent by the island page, handled by the main half; `window.island.hide(): void` on the page's bridge.

- [ ] **Step 1: Add the channel the island page sends**

In `src/window.ts`, add to `IslandWindowOptions`:

```ts
  /** The island was turned off, so its window goes away. */
  onHide: () => void
```

Add the handler next to `onToggle`, and register it next to the other channels:

```ts
  const onHide = (event: Electron.IpcMainEvent) => {
    if (ours(event.sender)) options.onHide()
  }
```

```ts
  ipcMain.on(`${CHANNEL}:hide`, onHide)
```

and, in `dispose()`, `ipcMain.removeListener(`${CHANNEL}:hide`, onHide)`.

- [ ] **Step 2: Add the method to the bridge**

In `src/island/preload.cjs`, next to `toggle`:

```js
  hide: () => ipcRenderer.send("opencode-island:hide"),
```

In `src/island/app/global.d.ts`, next to `toggle`:

```ts
      hide: () => void
```

- [ ] **Step 3: Add the dependency the flag's schema needs**

In `package.json`, add `"effect": "^4.1.0"` to `dependencies` (it is already installed as a transitive dependency of `@opencode/plugin`; the app provides `effect` to the plugin's GUI bundle, so the import stays external and the app's own instance is used).

- [ ] **Step 4: Own the flag in the main half**

In `src/gui.tsx`:

- Import `MenubarItem` from `@opencode/plugin/gui/main` and `Schema` from `effect`.
- In `main(ctx)`, before the window bookkeeping:

```ts
    // Whether the island is on. The app's own storage keeps it, so the island
    // stays off when OpenCode restarts.
    const enabled = ctx.storage.store("enabled", { schema: Schema.Boolean, initial: true })
```

- Change `sync()` to pass the flag:

```ts
    const sync = () => {
      if (islandShouldExist(windows.size, enabled.value)) create()
      else destroy()
    }
```

- Add the `onHide` handler to the `createIslandWindow` options, next to `onToggle`:

```ts
        onHide: () => {
          enabled.set(false)
          sync()
        },
```

- Add the menu item, after `sync()` is defined:

```ts
    // The way back: the island is gone while it is off, so the app's own menu
    // is what turns it on again.
    ctx.add(MenubarItem, () => ({
      menu: "app" as const,
      id: "island",
      label: enabled.value ? "Hide island" : "Show island",
      run: () => {
        enabled.set(!enabled.value)
        sync()
      },
    }))
```

- [ ] **Step 5: Add the button to the island**

In `src/island/app/components/island.tsx`, import `EyeSlash` from `@phosphor-icons/react` and add the button in the drawer's bottom bar, between the "Open OpenCode" button and the "Quit" button:

```tsx
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => window.island.hide()}
              aria-label="Turn the island off"
              title="Turn the island off. Turn it back on from the OpenCode menu."
              className={cn(alert && "border-warning-foreground/30 bg-transparent hover:bg-warning-foreground/10")}
            >
              <EyeSlash weight="duotone" />
            </Button>
```

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both pass. The build must not fail with "is not a module the OpenCode app provides to plugin GUIs" — `effect` and `@opencode/plugin/gui/main` are both provided. The `menu` value needs `as const`, or TypeScript widens it to `string` and the menu item does not typecheck.

- [ ] **Step 7: Run the check**

Run: `npm run check`
Expected: PASS, no output.

- [ ] **Step 8: Try it in the app**

Run: `npm run build`, then start the OpenCode desktop app with the plugin linked (`ln -s "$PWD" ~/.config/opencode/plugins/opencode-island` if it is not linked already).

- The drawer's bottom bar shows an eye-slash button between "Open OpenCode" and the power button.
- Pressing it makes the island disappear at once.
- The OpenCode app menu shows `Show island`; choosing it brings the island back as the closed tab, with the size and position it had.
- The menu item reads `Hide island` again, and pressing the eye-slash again turns it off: one island, not two.
- Turn the island off while an approval is waiting: the island goes, nothing is left half-open, and the approval is answered in OpenCode.
- Close OpenCode's last window while the island is off, then open a window again: no island appears.
- Restart OpenCode: the island is still off, and the menu item still reads `Show island`.

- [ ] **Step 9: Commit**

```bash
git add src/window.ts src/gui.tsx src/island/preload.cjs src/island/app/global.d.ts src/island/app/components/island.tsx package.json package-lock.json
git commit -m "feat: the island can be turned off, and back on from the app menu"
```

---

### Task 3: The README says how to turn it off

**Files:**
- Modify: `README.md` — the bottom bar table, a short section under "Use", and the "Limits" list.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the control to the bottom bar table**

In the "The bottom bar" table, add a row after the `⬛` row:

| 👁 | Turn the island off: the island disappears, and the OpenCode menu brings it back |

- [ ] **Step 2: Say where the way back is**

Under "### The bottom bar", add a short paragraph:

```markdown
The eye-slash button turns the island off: it disappears from the screen and
stays off until you bring it back. The way back is the OpenCode menu — on
macOS the app menu, `OpenCode → Show island`, on Windows the same item in the
in-app menu. The island stays off when OpenCode restarts; the other switches
in this bar do not.
```

- [ ] **Step 3: Correct the limits**

In the "Limits" list, the bullet that says the switches are remembered for the session only now reads:

```markdown
- The island's spot along the edge, its appearance and its switches are
  remembered for the session only; they reset when the app restarts. The
  island being turned off is the exception: that one is kept.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: the island can be turned off"
```
