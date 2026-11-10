import assert from "node:assert/strict"
import { keepWords, lastWords } from "../src/model.ts"

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

console.log("ok")
