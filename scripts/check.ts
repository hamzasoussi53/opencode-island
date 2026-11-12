import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { keepWords, lastWords } from "../src/model.ts"
import { islandShouldExist } from "../src/lifecycle.ts"
import { barOrbState, orbState } from "../src/orb.ts"

// The island shows the last ten words of an answer while it streams.
assert.equal(lastWords("one two three", 10), "one two three")
assert.equal(lastWords("a b c d e f g h i j k l", 10), "c d e f g h i j k l")
assert.equal(lastWords("   ", 10), "")
assert.equal(lastWords("", 10), "")

// A cut inside a word would show half of it, so the buffer keeps whole words.
const cut = keepWords(`${"a ".repeat(200)}zebra`)
assert.ok(cut.endsWith("zebra"))
assert.ok(cut.startsWith("a "))
assert.ok(cut.length <= 200)
assert.equal(keepWords("hi there"), "hi there")

// A live session gets an orb that names what it is doing.
assert.equal(orbState({ phase: "thinking" }), "breathing")
assert.equal(orbState({ phase: "writing" }), "composing")
assert.equal(orbState({ phase: "retrying" }), "solving")
assert.equal(orbState({ phase: "working", tool: "shell" }), "solving")
assert.equal(orbState({ phase: "working", tool: "grep" }), "searching")
assert.equal(orbState({ phase: "working", tool: "write" }), "composing")
assert.equal(orbState({ phase: "working", tool: "task" }), "weaving")
assert.equal(orbState({ phase: "working" }), "working")
assert.equal(orbState({ phase: "working", tool: "something-new" }), "working")

// An idle session and one waiting on an approval keep the plain dot.
assert.equal(orbState({ phase: "idle" }), undefined)
assert.equal(orbState({ phase: "waiting" }), undefined)
assert.equal(orbState({}), undefined)

// A tool name is data from the wire, so it never gets to be a key of anything.
assert.equal(orbState({ phase: "working", tool: "toString" }), "working")
assert.equal(orbState({ phase: "working", tool: "__proto__" }), "working")
assert.equal(orbState({ phase: "working", tool: "constructor" }), "working")

// The bar keeps the warning dot for as long as an approval is waiting.
assert.equal(barOrbState({ phase: "thinking" }, false), "breathing")
assert.equal(barOrbState({ phase: "thinking" }, true), undefined)
assert.equal(barOrbState(undefined, false), undefined)

// The island must not take the app's taskbar button with it, or there is
// nothing to right-click to close OpenCode. It is a window option, so the
// only way to hold it is to read the source.
const windowSource = readFileSync(new URL("../src/window.ts", import.meta.url), "utf8")

// The island must not take the app's taskbar button with it, or there is
// nothing to right-click to close OpenCode.
assert.match(windowSource, /skipTaskbar: false/)

// The island exists while the app has a window, and not one moment longer.
assert.equal(islandShouldExist(0), false)
assert.equal(islandShouldExist(1), true)
assert.equal(islandShouldExist(3), true)

console.log("ok")
