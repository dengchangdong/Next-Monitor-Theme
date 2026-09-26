import assert from "node:assert/strict"

import { getSplitTargets, isIpAddress, maskIpAddress } from "./network-diagnostics.ts"

assert.equal(isIpAddress("203.0.113.7"), true)
assert.equal(isIpAddress("203.0.113.999"), false)
assert.equal(isIpAddress("2001:db8::1"), true)
assert.equal(isIpAddress("not-an-address"), false)
assert.equal(maskIpAddress("203.0.113.7"), "203.0.*.*")
assert.equal(maskIpAddress("2001:db8::1"), "2001:db8::****:****")
assert.ok(getSplitTargets().length >= 12)
assert.equal(new Set(getSplitTargets().map((target) => target.id)).size, getSplitTargets().length)

console.log("network diagnostics 校验通过")
