// 领域 + 存储闭环测试入口（被 tools/test-domain.mjs 打包执行）。

import { repo, HoofTempRepository } from "../src/storage/repository";
import type {
  CoolingOutcome,
  CorrectOutcome,
  RecheckOutcome,
  SubmitOutcome,
} from "../src/storage/repository";
import {
  HOOFS,
  evaluateTemps,
  trainingRoster,
  isUnderObservation,
  episodeTimeline,
} from "../src/domain/rules";
import type { RootState } from "../src/domain/types";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function tok(): string {
  return `test-${Math.random().toString(36).slice(2)}`;
}

async function flush(ms = 300): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function runTests(): Promise<void> {
  // 确保从干净的演示存档开始（单例在模块导入时即初始化）
  localStorage.clear();
  repo.resetDemoData();

  console.log("== 1. 纯规则阈值 ==");
  check("单蹄 38.6 越线", evaluateTemps({ LF: 38.6 }).length === 1);
  check("单蹄 38.5 不越线（严格大于）", evaluateTemps({ LF: 38.5 }).length === 0);
  check("前蹄差 1.6 越线", evaluateTemps({ LF: 39.0, RF: 37.4 }).some((r) => r.includes("温差")));
  check("前蹄差 1.5 不越线", !evaluateTemps({ LF: 38.9, RF: 37.4 }).some((r) => r.includes("温差")));
  check("全部正常无原因", evaluateTemps({ LF: 37, RF: 37.2, LH: 36.9, RH: 37.1 }).length === 0);

  console.log("== 2. 种子数据训练名单 ==");
  const s0 = repo.getState();
  const d0 = new Date();
  const today = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(
    d0.getDate()
  ).padStart(2, "0")}`;
  const roster0 = trainingRoster(s0.horses, today, s0.tempRecords, s0.episodes, s0.events);
  check("HORSE-31 准予训练", roster0.cleared.some((s) => s.horseId === "HORSE-31"));
  check("HORSE-18 禁入", roster0.blocked.some((s) => s.horseId === "HORSE-18"));
  check("HORSE-27 禁入", roster0.blocked.some((s) => s.horseId === "HORSE-27"));
  check("HORSE-09 待补测", roster0.pending.some((s) => s.horseId === "HORSE-09"));
  check("HORSE-42 今日待补测（历史日已解除不影响今日）",
    roster0.pending.some((s) => s.horseId === "HORSE-42"));

  console.log("== 3. 每蹄每天唯一有效 + 重复提交沿用首次 ==");
  const horse = "HORSE-09";
  const t1 = tok();
  const r1 = await repo.submitTemp({ horseId: horse, date: today, hoof: "LF", temperature: 37.5, clientToken: t1 });
  check("首次提交生效", r1.accepted && !r1.duplicate);
  // 同令牌重复（含刷新后重放语义）：原样返回首次提交结果
  const r1b = await repo.submitTemp({ horseId: horse, date: today, hoof: "LF", temperature: 39.9, clientToken: t1 });
  check("同令牌重复原样重放首次结果", r1b.accepted === r1.accepted && r1b.temperature === 37.5 && r1b.recordId === r1.recordId);
  // 不同令牌同业务键
  const r2 = await repo.submitTemp({ horseId: horse, date: today, hoof: "LF", temperature: 39.9, clientToken: tok() });
  check("不同令牌重复提交沿用首次温度", r2.duplicate && r2.temperature === 37.5 && !r2.accepted);
  const activeLf = s0 && repo.getState().tempRecords.filter(
    (r) => r.horseId === horse && r.date === today && r.hoof === "LF" && !r.supersededAt &&
      (r.source === "initial" || r.source === "correction")
  );
  check("当日该蹄仅一条有效记录", activeLf.length === 1, `实际 ${activeLf.length}`);
  check("重复记录已归档", repo.getState().tempRecords.some((r) => r.supersededReason === "duplicate"));

  console.log("== 4. 并发提交：只沿用首次结果 ==");
  const [c1, c2] = await Promise.all([
    repo.submitTemp({ horseId: horse, date: today, hoof: "RF", temperature: 39.2, clientToken: tok() }),
    repo.submitTemp({ horseId: horse, date: today, hoof: "RF", temperature: 36.5, clientToken: tok() }),
  ]);
  const cWin = c1.accepted ? c1 : c2;
  const cLose = c1.accepted ? c2 : c1;
  check("并发仅一条生效", (c1.accepted ? 1 : 0) + (c2.accepted ? 1 : 0) === 1);
  check("并发两次返回同一有效温度", c1.temperature === c2.temperature && cWin.temperature === c1.temperature);
  check("负方归档 duplicate", cLose.duplicate === true);
  check("并发首次 39.2 越线 → 进观察、禁训", cWin.temperature === 39.2 && cWin.abnormal);

  console.log("== 5. 观察闭环：降温前置 + 连续两次复测 ==");
  // 找到 HORSE-09 今日观察档案
  const ep09 = repo.getState().episodes.find(
    (e) => e.horseId === horse && e.triggerDate === today
  )!;
  check("观察档案已建立", Boolean(ep09));
  check("观察中", isUnderObservation(ep09, repo.getState().events));

  let recheckBlocked = false;
  try {
    await repo.recordRecheck({
      episodeId: ep09.id,
      temperatures: { LF: 37.2, RF: 37.1, LH: 37.0, RH: 37.0 },
      clientToken: tok(),
    });
  } catch {
    recheckBlocked = true;
  }
  check("未记录降温时复测被拒", recheckBlocked);

  const cool = (await repo.recordCooling({
    episodeId: ep09.id,
    action: "冷水冲蹄 20 分钟",
    clientToken: tok(),
  })) as CoolingOutcome;
  check("降温已记录", Boolean(cool.eventId));

  const rc1 = (await repo.recordRecheck({
    episodeId: ep09.id,
    temperatures: { LF: 37.2, RF: 37.1, LH: 37.0, RH: 37.0 },
    clientToken: tok(),
  })) as RecheckOutcome;
  check("复测1正常 streak=1 未解除", rc1.normal && rc1.streak === 1 && !rc1.released);

  // 一次异常复测打断
  const rcBad = (await repo.recordRecheck({
    episodeId: ep09.id,
    temperatures: { LF: 39.0, RF: 37.1, LH: 37.0, RH: 37.0 },
    clientToken: tok(),
  })) as RecheckOutcome;
  check("异常复测打断连续计数", !rcBad.normal && rcBad.streak === 0);

  const rc2 = (await repo.recordRecheck({
    episodeId: ep09.id,
    temperatures: { LF: 37.3, RF: 37.2, LH: 37.0, RH: 37.1 },
    clientToken: tok(),
  })) as RecheckOutcome;
  check("复测2正常 streak=1", rc2.normal && rc2.streak === 1 && !rc2.released);

  const rc3 = (await repo.recordRecheck({
    episodeId: ep09.id,
    temperatures: { LF: 37.4, RF: 37.2, LH: 37.1, RH: 37.0 },
    clientToken: tok(),
  })) as RecheckOutcome;
  check("复测3正常 streak=2 自动解除", rc3.normal && rc3.streak === 2 && rc3.released);
  const ep09b = repo.getState().episodes.find((e) => e.id === ep09.id)!;
  check("档案状态 released", ep09b.status === "released" && !isUnderObservation(ep09b, repo.getState().events));

  console.log("== 6. 更正原蹄温 => 旧解除立即失效 ==");
  // 找到今日 HORSE-09 的有效 LF 记录
  const lfRec = repo.getState().tempRecords.find(
    (r) => r.horseId === horse && r.date === today && r.hoof === "LF" && !r.supersededAt &&
      (r.source === "initial" || r.source === "correction")
  )!;
  const fix = (await repo.correctTemp({
    recordId: lfRec.id,
    temperature: 39.4,
    clientToken: tok(),
    note: "复测核对后更正",
  })) as CorrectOutcome;
  check("更正返回 releaseRevoked", fix.releaseRevoked === true);
  const ep09c = repo.getState().episodes.find((e) => e.id === ep09.id)!;
  check("档案重开 observing", ep09c.status === "observing" && isUnderObservation(ep09c, repo.getState().events));
  const tl = episodeTimeline(repo.getState().events, ep09.id);
  check("时间线含失效解除 + revocation",
    tl.some((e) => e.kind === "release" && !e.active) && tl.some((e) => e.kind === "revocation"));
  // 旧复测计数被锚点重置
  const rosterBlocked = trainingRoster(
    repo.getState().horses, today, repo.getState().tempRecords, repo.getState().episodes, repo.getState().events
  );
  check("更正后重新禁入训练", rosterBlocked.blocked.some((s) => s.horseId === horse));
  // 旧记录留档
  check("旧记录留档（superseded correction）",
    repo.getState().tempRecords.some((r) => r.id === lfRec.id && r.supersededReason === "correction"));

  // 失效后必须重新降温 + 两次复测（注意：此前 cooling 仍在，但锚点后的 streak 为 0；
  // 规则语义：更正后需连续两次复测正常；hasCooling 观察期已满足）
  const f1 = await repo.recordRecheck({
    episodeId: ep09.id,
    temperatures: { LF: 37.5, RF: 37.3 },
    clientToken: tok(),
  });
  check("失效后复测1 streak=1", f1.normal && f1.streak === 1 && !f1.released);
  const f2 = await repo.recordRecheck({
    episodeId: ep09.id,
    temperatures: { LF: 37.4, RF: 37.2 },
    clientToken: tok(),
  });
  check("失效后复测2 streak=2 再解除", f2.normal && f2.streak === 2 && f2.released);

  console.log("== 7. 幂等：操作令牌重放（含冷却/复测） ==");
  // 另起一匹马做 cooling/recheck 令牌重放
  const ep27 = repo.getState().episodes.find((e) => e.horseId === "HORSE-27" && e.triggerDate === today)!;
  const ct = tok();
  const coolA = await repo.recordCooling({ episodeId: ep27.id, action: "冰靴 30 分钟", clientToken: ct });
  const coolB = await repo.recordCooling({ episodeId: ep27.id, action: "完全不同的措施", clientToken: ct });
  check("降温同令牌重放同一事件", coolA.eventId === coolB.eventId);
  const rt = tok();
  const rrA = await repo.recordRecheck({
    episodeId: ep27.id, temperatures: { LF: 37.4, RF: 37.2, LH: 37.0, RH: 37.1 }, clientToken: rt,
  });
  const rrB = await repo.recordRecheck({
    episodeId: ep27.id, temperatures: { LF: 39.9, RF: 37.2, LH: 37.0, RH: 37.1 }, clientToken: rt,
  });
  check("复测同令牌重放同一事件", rrA.eventId === rrB.eventId && rrB.normal === rrA.normal);
  check("重放不产生第二条事件",
    repo.getState().events.filter((e) => e.episodeId === ep27.id && e.kind === "recheck").length === 1);

  console.log("== 8. 刷新后状态一致（localStorage 重新加载） ==");
  const before: RootState = JSON.parse(JSON.stringify(repo.getState()));
  const repo2 = new HoofTempRepository();
  const after = repo2.getState();
  check("马匹/记录/事件数量一致",
    after.horses.length === before.horses.length &&
    after.tempRecords.length === before.tempRecords.length &&
    after.events.length === before.events.length &&
    after.episodes.length === before.episodes.length);
  const rosterAfter = trainingRoster(after.horses, today, after.tempRecords, after.episodes, after.events);
  const rosterBefore = trainingRoster(before.horses, today, before.tempRecords, before.episodes, before.events);
  check("刷新后训练名单一致",
    JSON.stringify(rosterAfter.cleared.map((s) => s.horseId).sort()) ===
    JSON.stringify(rosterBefore.cleared.map((s) => s.horseId).sort()) &&
    JSON.stringify(rosterAfter.blocked.map((s) => s.horseId).sort()) ===
    JSON.stringify(rosterBefore.blocked.map((s) => s.horseId).sort()));
  // 刷新后用旧令牌重试仍重放
  const replayAfter = await repo2.submitTemp({
    horseId: horse, date: today, hoof: "LF", temperature: 33.0, clientToken: t1,
  });
  check("刷新后旧令牌仍返回首次结果", replayAfter.temperature === 37.5 && replayAfter.recordId === r1.recordId);
  check("刷新后重放不新增记录", repo2.getState().tempRecords.length === after.tempRecords.length);

  console.log("== 9. 复测记录不污染当日有效蹄温 / 解除后恢复训练 ==");
  const recheckTemps = repo2.getState().tempRecords.filter((r) => r.source === "recheck" && r.horseId === horse && r.date === today);
  check("存在复测记录", recheckTemps.length > 0);
  const rosterNow = trainingRoster(after.horses, today, repo2.getState().tempRecords, after.episodes, repo2.getState().events);
  // 走完完整复测闭环并解除后，即便晨测 39.4 仍在有效记录里，也已被闭环裁决为可训练
  check("二次解除后恢复训练（闭环裁决优先于晨测温度）",
    rosterNow.cleared.some((s) => s.horseId === horse));

  void HOOFS;
  void flush;
  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) process.exitCode = 1;
}
