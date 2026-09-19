// 演示种子数据：覆盖
// - 观察中（已降温，连续正常 1/2）        HORSE-18
// - 观察中（未处置）                        HORSE-27
// - 四蹄正常、当日可训练                    HORSE-31（含一条重复归档历史）
// - 未测蹄温、待补测                        HORSE-09
// - 旧解除因原蹄温更正而失效、留档，再次解除 HORSE-42（-2 日历史）

import type {
  EpisodeEvent,
  Horse,
  ObservationEpisode,
  RootState,
  TempRecord,
} from "../domain/types";
import { dayOffset, isoAt, isoNow } from "../lib/time";

export const SEED_HORSES: Horse[] = [
  { id: "HORSE-18", name: "风影", stable: "A 厩 03", category: "运动马" },
  { id: "HORSE-27", name: "铁柱", stable: "B 厩 01", category: "运动马" },
  { id: "HORSE-31", name: "小步", stable: "A 厩 07", category: "运动马" },
  { id: "HORSE-09", name: "栗子", stable: "C 厩 02", category: "休养马" },
  { id: "HORSE-42", name: "老灰", stable: "B 厩 05", category: "运动马" },
];

function rec(
  id: string,
  horseId: string,
  offset: number,
  hoof: TempRecord["hoof"],
  temperature: number,
  source: TempRecord["source"],
  token: string,
  hour: number,
  extra: Partial<TempRecord> = {}
): TempRecord {
  return {
    id,
    horseId,
    date: dayOffset(offset),
    hoof,
    temperature,
    source,
    clientToken: token,
    createdAt: isoAt(offset, hour),
    createdBy: "蹄铁师·老周",
    ...extra,
  };
}

export function buildSeed(): RootState {
  const tempRecords: TempRecord[] = [];
  const episodes: ObservationEpisode[] = [];
  const events: EpisodeEvent[] = [];

  const T = "LF" as const,
    R = "RF" as const,
    L = "LH" as const,
    H = "RH" as const;

  // —— HORSE-18：今日 左前蹄 39.1℃ 触发；已降温，连续正常复测 1/2 ——
  tempRecords.push(
    rec("seed-r-18-lf", "HORSE-18", 0, T, 39.1, "initial", "seed-t-18-lf", 8),
    rec("seed-r-18-rf", "HORSE-18", 0, R, 37.2, "initial", "seed-t-18-rf", 8),
    rec("seed-r-18-lh", "HORSE-18", 0, L, 36.9, "initial", "seed-t-18-lh", 8),
    rec("seed-r-18-rh", "HORSE-18", 0, H, 37.0, "initial", "seed-t-18-rh", 8)
  );
  episodes.push({
    id: "seed-ep-18",
    horseId: "HORSE-18",
    triggerDate: dayOffset(0),
    sourceRecordIds: ["seed-r-18-lf", "seed-r-18-rf", "seed-r-18-lh", "seed-r-18-rh"],
    reasons: ["左前蹄 39.1℃ 超过 38.5℃", "左右前蹄温差 1.9℃ 超过 1.5℃"],
    status: "observing",
    openedAt: isoAt(0, 8, 5),
  });
  events.push(
    {
      kind: "cooling",
      id: "seed-ev-18-cool1",
      episodeId: "seed-ep-18",
      at: isoAt(0, 8, 20),
      action: "冷水冲蹄 20 分钟 + 冰靴",
      note: "左前蹄重点降温",
      clientToken: "seed-c-18-1",
    },
    {
      kind: "recheck",
      id: "seed-ev-18-rc1",
      episodeId: "seed-ep-18",
      at: isoAt(0, 10),
      temperatures: { LF: 37.6, RF: 37.3, LH: 37.0, RH: 37.1 },
      normal: true,
      reasons: [],
      recordIds: ["seed-r-18-rc1-lf", "seed-r-18-rc1-rf", "seed-r-18-rc1-lh", "seed-r-18-rc1-rh"],
      clientToken: "seed-rc-18-1",
    }
  );
  tempRecords.push(
    rec("seed-r-18-rc1-lf", "HORSE-18", 0, T, 37.6, "recheck", "seed-rc-18-1", 10, {
      recheckId: "seed-ev-18-rc1",
    }),
    rec("seed-r-18-rc1-rf", "HORSE-18", 0, R, 37.3, "recheck", "seed-rc-18-1", 10, {
      recheckId: "seed-ev-18-rc1",
    }),
    rec("seed-r-18-rc1-lh", "HORSE-18", 0, L, 37.0, "recheck", "seed-rc-18-1", 10, {
      recheckId: "seed-ev-18-rc1",
    }),
    rec("seed-r-18-rc1-rh", "HORSE-18", 0, H, 37.1, "recheck", "seed-rc-18-1", 10, {
      recheckId: "seed-ev-18-rc1",
    })
  );

  // —— HORSE-27：今日 右前蹄 38.9℃ 触发，尚未做降温处置 ——
  tempRecords.push(
    rec("seed-r-27-lf", "HORSE-27", 0, T, 37.4, "initial", "seed-t-27-lf", 8),
    rec("seed-r-27-rf", "HORSE-27", 0, R, 38.9, "initial", "seed-t-27-rf", 8),
    rec("seed-r-27-lh", "HORSE-27", 0, L, 37.1, "initial", "seed-t-27-lh", 8),
    rec("seed-r-27-rh", "HORSE-27", 0, H, 37.2, "initial", "seed-t-27-rh", 8)
  );
  episodes.push({
    id: "seed-ep-27",
    horseId: "HORSE-27",
    triggerDate: dayOffset(0),
    sourceRecordIds: ["seed-r-27-lf", "seed-r-27-rf", "seed-r-27-lh", "seed-r-27-rh"],
    reasons: ["右前蹄 38.9℃ 超过 38.5℃"],
    status: "observing",
    openedAt: isoAt(0, 8, 5),
  });

  // —— HORSE-31：今日四蹄正常，可训练；另有一条更早的重复提交被归档 ——
  tempRecords.push(
    rec("seed-r-31-lf", "HORSE-31", 0, T, 37.0, "initial", "seed-t-31-lf", 8),
    rec("seed-r-31-rf", "HORSE-31", 0, R, 37.3, "initial", "seed-t-31-rf", 8),
    rec("seed-r-31-lh", "HORSE-31", 0, L, 36.8, "initial", "seed-t-31-lh", 8),
    rec("seed-r-31-rh", "HORSE-31", 0, H, 37.1, "initial", "seed-t-31-rh", 8),
    rec("seed-r-31-rf-dup", "HORSE-31", 0, R, 37.9, "initial", "seed-t-31-rf-dup", 9, {
      note: "测温枪未校准的误报，重复提交",
      supersededAt: isoAt(0, 9, 1),
      supersededReason: "duplicate",
      supersededBy: "seed-t-31-rf",
    })
  );

  // —— HORSE-42：-2 日触发 → 降温 → 两次复测正常 → 解除；
  //    -1 日更正原蹄温（实际更高）→ 旧解除立即失效 → 再降温两次复测正常 → 重新解除 ——
  tempRecords.push(
    rec("seed-r-42-rf", "HORSE-42", -2, R, 37.1, "initial", "seed-t-42-rf", 8),
    rec("seed-r-42-lh", "HORSE-42", -2, L, 37.0, "initial", "seed-t-42-lh", 8),
    rec("seed-r-42-rh", "HORSE-42", -2, H, 37.0, "initial", "seed-t-42-rh", 8)
  );
  episodes.push({
    id: "seed-ep-42",
    horseId: "HORSE-42",
    triggerDate: dayOffset(-2),
    sourceRecordIds: ["seed-r-42-lf-fix", "seed-r-42-rf", "seed-r-42-lh", "seed-r-42-rh"],
    reasons: ["左前蹄 39.3℃ 超过 38.5℃", "左右前蹄温差 2.2℃ 超过 1.5℃"],
    status: "released",
    openedAt: isoAt(-2, 8, 5),
    activeReleaseId: "seed-ev-42-rel2",
  });
  events.push(
    {
      kind: "cooling",
      id: "seed-ev-42-cool1",
      episodeId: "seed-ep-42",
      at: isoAt(-2, 8, 20),
      action: "冷水冲蹄 20 分钟",
      clientToken: "seed-c-42-1",
    },
    {
      kind: "recheck",
      id: "seed-ev-42-rc1",
      episodeId: "seed-ep-42",
      at: isoAt(-2, 10),
      temperatures: { LF: 37.6, RF: 37.2 },
      normal: true,
      reasons: [],
      recordIds: ["seed-r-42-rc1-lf", "seed-r-42-rc1-rf"],
      clientToken: "seed-rc-42-1",
    },
    {
      kind: "recheck",
      id: "seed-ev-42-rc2",
      episodeId: "seed-ep-42",
      at: isoAt(-2, 14),
      temperatures: { LF: 37.4, RF: 37.1 },
      normal: true,
      reasons: [],
      recordIds: ["seed-r-42-rc2-lf", "seed-r-42-rc2-rf"],
      clientToken: "seed-rc-42-2",
    },
    {
      kind: "release",
      id: "seed-ev-42-rel1",
      episodeId: "seed-ep-42",
      at: isoAt(-2, 14, 1),
      afterRecheckIds: ["seed-ev-42-rc1", "seed-ev-42-rc2"],
      active: false,
      revokedAt: isoAt(-1, 9),
      revokeReason: "原蹄温更正：左前蹄初测 38.8℃ 更正为 39.3℃，旧解除立即失效",
    },
    {
      kind: "revocation",
      id: "seed-ev-42-rev1",
      episodeId: "seed-ep-42",
      at: isoAt(-1, 9),
      releaseId: "seed-ev-42-rel1",
      correctedRecordId: "seed-r-42-lf-fix",
      newTriggerReasons: ["左前蹄 39.3℃ 超过 38.5℃", "左右前蹄温差 2.2℃ 超过 1.5℃"],
    },
    {
      kind: "cooling",
      id: "seed-ev-42-cool2",
      episodeId: "seed-ep-42",
      at: isoAt(-1, 9, 15),
      action: "冰靴冷敷 30 分钟 + 圈养观察",
      clientToken: "seed-c-42-2",
    },
    {
      kind: "recheck",
      id: "seed-ev-42-rc3",
      episodeId: "seed-ep-42",
      at: isoAt(-1, 11),
      temperatures: { LF: 37.5, RF: 37.2 },
      normal: true,
      reasons: [],
      recordIds: ["seed-r-42-rc3-lf", "seed-r-42-rc3-rf"],
      clientToken: "seed-rc-42-3",
    },
    {
      kind: "recheck",
      id: "seed-ev-42-rc4",
      episodeId: "seed-ep-42",
      at: isoAt(-1, 15),
      temperatures: { LF: 37.3, RF: 37.1 },
      normal: true,
      reasons: [],
      recordIds: ["seed-r-42-rc4-lf", "seed-r-42-rc4-rf"],
      clientToken: "seed-rc-42-4",
    },
    {
      kind: "release",
      id: "seed-ev-42-rel2",
      episodeId: "seed-ep-42",
      at: isoAt(-1, 15, 1),
      afterRecheckIds: ["seed-ev-42-rc3", "seed-ev-42-rc4"],
      active: true,
    }
  );
  tempRecords.push(
    rec("seed-r-42-rc1-lf", "HORSE-42", -2, T, 37.6, "recheck", "seed-rc-42-1", 10, {
      recheckId: "seed-ev-42-rc1",
    }),
    rec("seed-r-42-rc1-rf", "HORSE-42", -2, R, 37.2, "recheck", "seed-rc-42-1", 10, {
      recheckId: "seed-ev-42-rc1",
    }),
    rec("seed-r-42-rc2-lf", "HORSE-42", -2, T, 37.4, "recheck", "seed-rc-42-2", 14, {
      recheckId: "seed-ev-42-rc2",
    }),
    rec("seed-r-42-rc2-rf", "HORSE-42", -2, R, 37.1, "recheck", "seed-rc-42-2", 14, {
      recheckId: "seed-ev-42-rc2",
    }),
    // 更正：初测左前蹄 38.8 -> 39.3；旧记录留档
    rec("seed-r-42-lf", "HORSE-42", -2, T, 38.8, "initial", "seed-t-42-lf", 8, {
      supersededAt: isoAt(-1, 9),
      supersededReason: "correction",
      supersededBy: "seed-fix-42-lf",
    }),
    rec("seed-r-42-lf-fix", "HORSE-42", -2, T, 39.3, "correction", "seed-fix-42-lf", 9, {
      correctionOf: "seed-r-42-lf",
      note: "核对红外测温记录后更正",
    }),
    rec("seed-r-42-rc3-lf", "HORSE-42", -1, T, 37.5, "recheck", "seed-rc-42-3", 11, {
      recheckId: "seed-ev-42-rc3",
    }),
    rec("seed-r-42-rc3-rf", "HORSE-42", -1, R, 37.2, "recheck", "seed-rc-42-3", 11, {
      recheckId: "seed-ev-42-rc3",
    }),
    rec("seed-r-42-rc4-lf", "HORSE-42", -1, T, 37.3, "recheck", "seed-rc-42-4", 15, {
      recheckId: "seed-ev-42-rc4",
    }),
    rec("seed-r-42-rc4-rf", "HORSE-42", -1, R, 37.1, "recheck", "seed-rc-42-4", 15, {
      recheckId: "seed-ev-42-rc4",
    })
  );

  return {
    horses: SEED_HORSES,
    tempRecords,
    episodes,
    events,
    requestIndex: {},
    seededAt: isoNow(),
  };
}
