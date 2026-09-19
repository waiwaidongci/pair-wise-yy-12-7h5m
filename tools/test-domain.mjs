// 业务闭环验证脚本：node tools/test-domain.mjs（由 esbuild 即时打包 TS）。
// 覆盖：唯一有效蹄温、阈值判定、重复/并发幂等、观察闭环、
//       更正失效旧解除、重开观察、刷新后状态一致。

import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- 浏览器环境垫片 ----
class MemoryStorage {
  m = new Map();
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const outfile = join(tmpdir(), "hoof-test-bundle.mjs");
await build({
  entryPoints: ["tools/test-entry.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile,
  logLevel: "silent",
});

globalThis.localStorage = new MemoryStorage();
const mod = await import(pathToFileURL(outfile).href);
await mod.runTests();
