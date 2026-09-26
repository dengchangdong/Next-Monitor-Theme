import assert from "node:assert/strict"

import { serverIdToServerKey } from "./server-key.ts"

assert.equal(serverIdToServerKey(1), "c4ca4238")
assert.equal(serverIdToServerKey("1"), "c4ca4238")
assert.equal(serverIdToServerKey(42), "a1d0c6e8")
assert.match(serverIdToServerKey(999), /^[a-f0-9]{8}$/)

console.log("server route key 校验通过")
