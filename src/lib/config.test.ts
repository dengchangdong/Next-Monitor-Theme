/// <reference types="node" />
import assert from "node:assert/strict"
import { defaultThemeConfig, loadThemeConfig } from "./config.ts"

const reply = (body: unknown, ok = true) => Promise.resolve({
  ok,
  json: () => Promise.resolve(body),
} as Response)

const configured = await loadThemeConfig(() => reply({ notice: "计划维护", show_network: false }))
assert.equal(configured.notice, "计划维护")
assert.equal(configured.show_network, false)
assert.equal(configured.show_resources, true)

const invalid = await loadThemeConfig(() => reply({ notice: 7, show_resources: "yes" }))
assert.equal(invalid.notice, "")
assert.equal(invalid.show_resources, true)

assert.deepEqual(await loadThemeConfig(() => reply({}, false)), defaultThemeConfig)
assert.deepEqual(await loadThemeConfig(() => Promise.reject(new Error("offline"))), defaultThemeConfig)
console.log("theme config falls back safely")
