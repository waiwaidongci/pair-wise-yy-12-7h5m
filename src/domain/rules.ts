// 业务判断层（纯函数，无存储、无 React、无副作用）
// 规则：
// 1) 每匹马每个蹄位每天只保留一条有效蹄温（initial / correction）。
// 2) 单蹄 > 38.5℃，或左右前蹄温差 > 1.5℃（严格大于）=> 异常，只能进入蹄叶炎观察。
// 3) 观察须记录降温处置；自锚点起连续两次复测均正常，且做过降温，才解除。
// 4) 原蹄温更正后旧解除立即失效，锚点重置，历史留档。

import type {
  EpisodeEvent,
  Hoof,
  ObservationEpisode,
  RecheckEvent,
  TempRecord,
} from "./types";

export const HOOFS: Hoof[] = ["LF", "RF", "LH", "RH"];

export const HOOF_LABEL: Record<Hoof, string> = {
  LF: "左前蹄",
  RF: "右前蹄",
  LH: "左后蹄",
  RH: "右后蹄",
};

/** 预警阈值 */
export const SINGLE_HOOF_MAX = 38.5;
export const FRONT_DIFF_MAX = 1.5;

export const FRONT_HOOFS: Hoof[] = ["LF", "RF"];

/** 有效蹄温（未被归档/更正）；复测记录不计入“当日有效蹄温” */
export function isActiveDailyRecord(r: TempRecord): boolean {
  return (
    !r.supersededAt && (r.source === "initial" || r.source === "correction")
  );
}

/** 某马某日每个蹄位的有效蹄温 */
export function dailyEffectiveTemps(
  records: TempRecord[],
  horseId: string,
  date: string
): Partial<Record<Hoof, number>> {
  const out: Partial<Record<Hoof, number>> = {};
  for (const r of records) {
    if (
      r.horseId === horseId &&
      r.date === date &&
      isActiveDailyRecord(r)
    ) {
      out[r.hoof] = r.temperature;
    }
  }
  return out;
}

/** 某马某日每个蹄位的有效蹄温记录（用于观察档案溯源） */
export function dailyEffectiveRecords(
  records: TempRecord[],
  horseId: string,
  date: string
): TempRecord[] {
  return records
    .filter(
      (r) =>
        r.horseId === horseId && r.date === date && isActiveDailyRecord(r)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 评估一组蹄温是否异常。
 * @returns 异常原因列表；空数组 = 正常（或暂无数据，调用方需自行区分“无数据”）
 */
export function evaluateTemps(temps: Partial<Record<Hoof, number>>): string[] {
  const reasons: string[] = [];
  for (const h of HOOFS) {
    const t = temps[h];
    if (t !== undefined && t > SINGLE_HOOF_MAX) {
      reasons.push(`${HOOF_LABEL[h]} ${t.toFixed(1)}℃ 超过 ${SINGLE_HOOF_MAX}℃`);
    }
  }
  const lf = temps.LF;
  const rf = temps.RF;
  if (lf !== undefined && rf !== undefined) {
    const diff = Math.abs(lf - rf);
    if (diff > FRONT_DIFF_MAX) {
      reasons.push(
        `左右前蹄温差 ${diff.toFixed(1)}℃ 超过 ${FRONT_DIFF_MAX}℃`
      );
    }
  }
  return reasons;
}

/** 是否有任意蹄温数据 */
export function hasAnyTemp(temps: Partial<Record<Hoof, number>>): boolean {
  return HOOFS.some((h) => temps[h] !== undefined);
}

/** 四蹄是否已测齐 */
export function allHoofsMeasured(
  temps: Partial<Record<Hoof, number>>
): boolean {
  return HOOFS.every((h) => temps[h] !== undefined);
}

/** 取观察档案的时间线（按时间升序） */
export function episodeTimeline(
  events: EpisodeEvent[],
  episodeId: string
): EpisodeEvent[] {
  return events
    .filter((e) => e.episodeId === episodeId)
    .sort((a, b) => {
      const ta = "at" in a ? a.at : "";
      const tb = "at" in b ? b.at : "";
      return ta.localeCompare(tb);
    });
}

/**
 * 连续复测正常计数的锚点（ISO 时间）。
 * 锚点之后的复测才计入“连续两次正常”；
 * 更正触发日原蹄温 / 解除被失效都会重置锚点。
 */
export function streakAnchor(
  ep: ObservationEpisode,
  events: EpisodeEvent[]
): string {
  let anchor = ep.openedAt;
  for (const e of events) {
    if (e.episodeId !== ep.id) continue;
    if (e.kind === "revocation") anchor = e.at;
  }
  return anchor;
}

/** 锚点之后、且已记录降温处置的复测序列 */
export function rechecksAfterAnchor(
  ep: ObservationEpisode,
  events: EpisodeEvent[]
): RecheckEvent[] {
  const anchor = streakAnchor(ep, events);
  return episodeTimeline(events, ep.id).filter(
    (e): e is RecheckEvent => e.kind === "recheck" && e.at >= anchor
  );
}

/** 是否做过降温处置（观察期间至少一条 cooling 事件） */
export function hasCooling(
  ep: ObservationEpisode,
  events: EpisodeEvent[]
): boolean {
  return events.some(
    (e) => e.episodeId === ep.id && e.kind === "cooling"
  );
}

/** 锚点起连续正常复测次数 */
export function normalStreak(
  ep: ObservationEpisode,
  events: EpisodeEvent[]
): number {
  let n = 0;
  for (const rc of rechecksAfterAnchor(ep, events)) {
    if (rc.normal) n += 1;
    else n = 0;
  }
  return n;
}

/** 解除条件：连续两次复测正常，且已记录降温处置 */
export function releaseSatisfied(
  ep: ObservationEpisode,
  events: EpisodeEvent[]
): boolean {
  return hasCooling(ep, events) && normalStreak(ep, events) >= 2;
}

/** 当前有效的解除事件（可能已被失效） */
export function activeRelease(
  ep: ObservationEpisode,
  events: EpisodeEvent[]
): EpisodeEvent | undefined {
  return ep.activeReleaseId
    ? events.find((e) => e.id === ep.activeReleaseId)
    : undefined;
}

/** 档案在指定日期是否仍“处于观察”（有有效解除则不算） */
export function isUnderObservation(
  ep: ObservationEpisode,
  events: EpisodeEvent[]
): boolean {
  if (ep.status !== "observing") return false;
  const rel = activeRelease(ep, events);
  if (!rel) return true;
  return rel.kind === "release" && !rel.active;
}

/** 某马某日是否存在仍在观察的档案 */
export function activeEpisodeFor(
  episodes: ObservationEpisode[],
  events: EpisodeEvent[],
  horseId: string,
  date: string
): ObservationEpisode | undefined {
  return episodes.find(
    (ep) =>
      ep.horseId === horseId &&
      ep.triggerDate === date &&
      isUnderObservation(ep, events)
  );
}

export type TrainingGate =
  | "blocked" // 蹄叶炎观察：禁止当日训练
  | "pending" // 蹄温未测齐：不得列入当日训练
  | "cleared"; // 可列入当日训练

export interface HorseDayStatus {
  horseId: string;
  date: string;
  temps: Partial<Record<Hoof, number>>;
  abnormal: boolean;
  reasons: string[];
  gate: TrainingGate;
  episode?: ObservationEpisode;
}

/**
 * 计算单匹马单日的训练准入（只读纯函数，列表 / 训练名单 / 刷新后状态共用）。
 * 闭环语义：
 *  - 观察档案在身（observing / 解除已失效）=> blocked；
 *  - 当日档案已走完“降温+两次复测”解除 => cleared（异常晨测已被复测闭环裁决）；
 *  - 无档案但存在异常有效蹄温（防御性拦截）=> blocked；
 *  - 蹄温未测齐 => pending；四蹄测齐且正常 => cleared。
 */
export function horseDayStatus(
  horseId: string,
  date: string,
  records: TempRecord[],
  episodes: ObservationEpisode[],
  events: EpisodeEvent[]
): HorseDayStatus {
  const temps = dailyEffectiveTemps(records, horseId, date);
  const reasons = evaluateTemps(temps);
  const dayEp = episodes.find(
    (ep) => ep.horseId === horseId && ep.triggerDate === date
  );
  const ep = dayEp && isUnderObservation(dayEp, events) ? dayEp : undefined;
  const adjudicated = Boolean(dayEp && !ep);

  let gate: TrainingGate;
  if (ep) gate = "blocked";
  else if (adjudicated) gate = "cleared";
  else if (reasons.length > 0) gate = "blocked";
  else if (!allHoofsMeasured(temps)) gate = "pending";
  else gate = "cleared";

  return {
    horseId,
    date,
    temps,
    abnormal: reasons.length > 0,
    reasons,
    gate,
    episode: ep,
  };
}

export interface TrainingRoster {
  cleared: HorseDayStatus[];
  blocked: HorseDayStatus[];
  pending: HorseDayStatus[];
}

/** 当日训练名单：三栏，所有页面入口共用同一份派生结果 */
export function trainingRoster(
  horses: { id: string }[],
  date: string,
  records: TempRecord[],
  episodes: ObservationEpisode[],
  events: EpisodeEvent[]
): TrainingRoster {
  const roster: TrainingRoster = { cleared: [], blocked: [], pending: [] };
  for (const h of horses) {
    const s = horseDayStatus(h.id, date, records, episodes, events);
    roster[s.gate].push(s);
  }
  return roster;
}

/** 前蹄温差（两位蹄温都在时） */
export function frontDiff(
  temps: Partial<Record<Hoof, number>>
): number | undefined {
  return temps.LF !== undefined && temps.RF !== undefined
    ? Math.abs(temps.LF - temps.RF)
    : undefined;
}

/** 体温格式 */
export function fmtTemp(t: number | undefined): string {
  return t === undefined ? "—" : `${t.toFixed(1)}℃`;
}
