/**
 * 业务判断层（纯函数，无存储、无 UI 依赖）
 *
 * 闭环规则：
 * 1. 每匹马每个蹄位每天只保留一条有效蹄温，重复提交视为更正，旧记录留档。
 * 2. 左右前蹄温差 > 1.5℃ 或任意单蹄 > 38.5℃ → 只能进入蹄叶炎观察，禁止当日训练。
 * 3. 观察期内必须记录降温处置，且连续两次复测正常才允许解除。
 * 4. 原蹄温被更正后，该观察旧的解除立即失效（解除记录留档），观察重新开启。
 */

export type HoofPosition = "LF" | "RF" | "LH" | "RH";

export const HOOF_ORDER: HoofPosition[] = ["LF", "RF", "LH", "RH"];

export const HOOF_LABELS: Record<HoofPosition, string> = {
  LF: "左前蹄",
  RF: "右前蹄",
  LH: "左后蹄",
  RH: "右后蹄",
};

/** 预警阈值 */
export const SINGLE_HOOF_LIMIT_C = 38.5;
export const FRONT_DIFF_LIMIT_C = 1.5;

/** 解除观察所需：至少 1 次降温处置 + 连续正常复测次数 */
export const REQUIRED_TREATMENTS = 1;
export const REQUIRED_CONSECUTIVE_NORMAL_RECHECKS = 2;

export function todayStr(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${todayStr(d)} ${hh}:${mi}`;
}

/* ---------------- 蹄温记录 ---------------- */

export interface TempRecord {
  id: string;
  horseId: string;
  hoof: HoofPosition;
  /** 测量日期 YYYY-MM-DD */
  date: string;
  temperature: number;
  recordedAt: number;
  /** 每匹马每个蹄位每天仅一条 effective=true */
  effective: boolean;
  /** 被哪条更正记录取代（留档追溯） */
  supersededBy: string | null;
  /** 幂等提交凭证 */
  submissionKey: string;
}

/** 取某马某日四个蹄位的有效蹄温（防御性：同键多条有效时取最新，与存储层决胜规则一致） */
export function effectiveTempsFor(
  records: TempRecord[],
  horseId: string,
  date: string
): Partial<Record<HoofPosition, number>> {
  const latest = new Map<HoofPosition, TempRecord>();
  for (const r of records) {
    if (!r.effective || r.horseId !== horseId || r.date !== date) continue;
    const prev = latest.get(r.hoof);
    if (
      !prev ||
      prev.recordedAt < r.recordedAt ||
      (prev.recordedAt === r.recordedAt && prev.id < r.id)
    ) {
      latest.set(r.hoof, r);
    }
  }
  const out: Partial<Record<HoofPosition, number>> = {};
  for (const [hoof, rec] of latest) out[hoof] = rec.temperature;
  return out;
}

/* ---------------- 预警判定 ---------------- */

export type TriggerKind = "SINGLE_HIGH" | "FRONT_DIFF";

export interface Trigger {
  kind: TriggerKind;
  detail: string;
}

/**
 * 判定一组蹄温是否触发蹄叶炎预警。
 * 任意单蹄 > 38.5℃，或左右前蹄温差 > 1.5℃。
 */
export function evaluateDayTemps(
  temps: Partial<Record<HoofPosition, number>>
): Trigger | null {
  for (const hoof of HOOF_ORDER) {
    const v = temps[hoof];
    if (v !== undefined && v > SINGLE_HOOF_LIMIT_C) {
      return {
        kind: "SINGLE_HIGH",
        detail: `${HOOF_LABELS[hoof]} ${v.toFixed(1)}℃ 超过 ${SINGLE_HOOF_LIMIT_C}℃ 上限`,
      };
    }
  }
  const lf = temps.LF;
  const rf = temps.RF;
  if (lf !== undefined && rf !== undefined) {
    const diff = Math.abs(lf - rf);
    if (diff > FRONT_DIFF_LIMIT_C) {
      return {
        kind: "FRONT_DIFF",
        detail: `左右前蹄温差 ${diff.toFixed(1)}℃ 超过 ${FRONT_DIFF_LIMIT_C}℃ 上限`,
      };
    }
  }
  return null;
}

/* ---------------- 蹄叶炎观察 ---------------- */

export interface CoolingTreatment {
  id: string;
  at: number;
  method: string;
  note: string;
}

export interface RecheckEntry {
  id: string;
  at: number;
  temps: Partial<Record<HoofPosition, number>>;
  normal: boolean;
  detail: string;
}

export interface ReleaseEntry {
  at: number;
  /** 原蹄温更正后旧解除立即失效，留档 */
  invalidatedAt: number | null;
  invalidReason: string | null;
}

export interface ObservationEpisode {
  id: string;
  horseId: string;
  /** 触发日期 */
  date: string;
  trigger: Trigger;
  openedAt: number;
  /** 解除失效后重新开启的时间（解除资格只统计该时间之后的处置与复测） */
  reopenedAt: number | null;
  status: "active" | "released";
  treatments: CoolingTreatment[];
  rechecks: RecheckEntry[];
  releases: ReleaseEntry[];
  updatedAt: number;
}

/** 当前观察窗口起点：解除失效重开后，旧处置/复测不再计入解除资格（仍留档） */
export function observationWindowStart(ep: ObservationEpisode): number {
  return ep.reopenedAt ?? ep.openedAt;
}

export function treatmentsInWindow(ep: ObservationEpisode): CoolingTreatment[] {
  const since = observationWindowStart(ep);
  return ep.treatments.filter((t) => t.at >= since);
}

export function rechecksInWindow(ep: ObservationEpisode): RecheckEntry[] {
  const since = observationWindowStart(ep);
  return ep.rechecks.filter((r) => r.at >= since);
}

/** 窗口内连续正常复测次数（从最近一次往回数，遇异常即断） */
export function consecutiveNormalRechecks(ep: ObservationEpisode): number {
  const list = rechecksInWindow(ep);
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].normal) n++;
    else break;
  }
  return n;
}

/** 距允许解除还差什么（用于 UI 展示与按钮禁用原因） */
export function releaseBlockers(ep: ObservationEpisode): string[] {
  if (ep.status !== "active") return [];
  const blockers: string[] = [];
  const treatments = treatmentsInWindow(ep).length;
  if (treatments < REQUIRED_TREATMENTS) {
    blockers.push(`需记录降温处置（当前 ${treatments}/${REQUIRED_TREATMENTS}）`);
  }
  const normal = consecutiveNormalRechecks(ep);
  if (normal < REQUIRED_CONSECUTIVE_NORMAL_RECHECKS) {
    blockers.push(
      `需连续 ${REQUIRED_CONSECUTIVE_NORMAL_RECHECKS} 次复测正常（当前连续 ${normal} 次）`
    );
  }
  return blockers;
}

export function canRelease(ep: ObservationEpisode): boolean {
  return ep.status === "active" && releaseBlockers(ep).length === 0;
}

/* ---------------- 训练禁入 ---------------- */

export function activeEpisodeOf(
  episodes: ObservationEpisode[],
  horseId: string
): ObservationEpisode | undefined {
  return episodes.find((ep) => ep.horseId === horseId && ep.status === "active");
}

/** 观察中的马匹不得列入训练名单 */
export function isTrainingAllowed(
  episodes: ObservationEpisode[],
  horseId: string
): boolean {
  return activeEpisodeOf(episodes, horseId) === undefined;
}
