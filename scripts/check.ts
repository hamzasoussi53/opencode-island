import assert from "node:assert/strict"
import { keepWords, tail } from "../src/model.ts"

// The closed island shows the last words of an answer while it streams.
assert.equal(tail("the island now shows its own text", 2), "own text")
assert.equal(tail("hello there", 1), "there")
assert.equal(tail("   ", 2), "")
assert.equal(tail("x".repeat(80), 2).length, 24)

// A cut inside a word would show half of it, so the buffer keeps whole words.
const cut = keepWords(`${"a ".repeat(200)}zebra`)
assert.ok(cut.endsWith("zebra"))
assert.ok(cut.startsWith("a "))
assert.ok(cut.length <= 200)
assert.equal(keepWords("hi there"), "hi there")

console.log("ok")
