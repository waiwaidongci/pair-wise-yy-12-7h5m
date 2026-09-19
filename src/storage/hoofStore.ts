/**
 * 记录存储层（localStorage 持久化 + 幂等提交 + 并发合并）
 *
 * - 每次变更先从 localStorage 读入最新状态再写入，保证刷新后、多标签页间状态一致；
 * - 提交以 submissionKey 幂等：重复或并发提交一律沿用首次结果；
 * - 合并时提交日志「首次写入优先」，蹄温记录按 (马,蹄位,日期) 强制仅一条有效。
 */

import {
  evaluateDayTemps,
  effectiveTempsFor,
  canRelease,
  HOOF_LABELS,
  todayStr,
  type HoofPosition,
  type ObservationEpisode,
  type TempRecord,
} from "../domain/hoofDomain";

const STORAGE_KEY = "hxyfront-62011:hoof-loop:v1";

/* ---------------- 状态结构 ---------------- */

export interface SubmissionResult {
  submissionKey: string;
  recordId: string;
  horseId: string;
  hoof: HoofPosition;
  date: string;
  temperature: number;
  /** created=当日首条；corrected=更正（旧记录留档） */
  outcome: "created" | "corrected";
  /** 本次提交触发的观察 id */
  openedEpisodeId: string | null;
  /** 本次更正是否使旧解除失效 */
  invalidatedRelease: boolean;
  message: string;
  recordedAt: number;
}

export interface HoofState {
  records: TempRecord[];
  episodes: ObservationEpisode[];
  /** 幂等日志：submissionKey -> 首次处理结果 */
  submissions: Record<string, SubmissionResult>;
}

export interface SubmitOutcome {
  result: SubmissionResult;
  /** true 表示重复/并发提交，沿用首次结果 */
  deduplicated: boolean;
}

function uid(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

/** 单调时钟：同一毫秒的连续提交也能保证记录先后次序 */
let lastTick = 0;
function tick(): number {
  const t = Date.now();
  lastTick = t > lastTick ? t : lastTick + 1;
  return lastTick;
}

/* ---------------- 持久化与合并 ---------------- */

function load(): HoofState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HoofState;
    if (!Array.isArray(parsed.records) || !Array.isArray(parsed.episodes)) return null;
    return {
      records: parsed.records,
      episodes: parsed.episodes,
      submissions: parsed.submissions ?? {},
    };
  } catch {
    return null;
  }
}

/** 不变量兜底：同一 (马,蹄位,日期) 仅最新一条有效，其余留档 */
function enforceSingleEffective(records: TempRecord[]): void {
  const groups = new Map<string, TempRecord[]>();
  for (const r of records) {
    const key = `${r.horseId}|${r.hoof}|${r.date}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  for (const list of groups.values()) {
    // 时间相同（跨标签页并发）时按 id 决胜，保证各端合并结果一致
    list.sort((a, b) => b.recordedAt - a.recordedAt || b.id.localeCompare(a.id));
    list.forEach((r, i) => {
      r.effective = i === 0;
      if (i === 0) r.supersededBy = null;
    });
  }
}

/** 并发合并：提交日志首次写入优先；记录按 id 并集；观察取 updatedAt 较新者 */
function mergeStates(stored: HoofState, next: HoofState): HoofState {
  const submissions: Record<string, SubmissionResult> = { ...next.submissions };
  for (const [key, value] of Object.entries(stored.submissions)) {
    if (!(key in submissions)) submissions[key] = value;
  }

  const recordsById = new Map<string, TempRecord>();
  for (const r of stored.records) recordsById.set(r.id, r);
  for (const r of next.records) recordsById.set(r.id, r);
  const records = [...recordsById.values()];
  enforceSingleEffective(records);

  const episodesById = new Map<string, ObservationEpisode>();
  for (const ep of stored.episodes) episodesById.set(ep.id, ep);
  for (const ep of next.episodes) {
    const prev = episodesById.get(ep.id);
    if (!prev || prev.updatedAt <= ep.updatedAt) episodesById.set(ep.id, ep);
  }

  return { records, episodes: [...episodesById.values()], submissions };
}

function persist(next: HoofState): HoofState {
  const stored = load();
  const merged = stored ? mergeStates(stored, next) : next;
  enforceSingleEffective(merged.records);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

/* ---------------- 演示数据 ---------------- */

function seedState(): HoofState {
  const today = todayStr();
  const base = new Date();
  base.setHours(7, 30, 0, 0);
  const t0 = base.getTime();
  const minute = 60_000;

  const records: TempRecord[] = [];
  const submissions: Record<string, SubmissionResult> = {};
  const episodes: ObservationEpisode[] = [];

  const put = (
    horseId: string,
    hoof: HoofPosition,
    temperature: number,
    at: number
  ): TempRecord => {
    const rec: TempRecord = {
      id: uid("rec"),
      horseId,
      hoof,
      date: today,
      temperature,
      recordedAt: at,
      effective: true,
      supersededBy: null,
      submissionKey: `seed|${horseId}|${hoof}|${today}`,
    };
    records.push(rec);
    submissions[rec.submissionKey] = {
      submissionKey: rec.submissionKey,
      recordId: rec.id,
      horseId,
      hoof,
      date: today,
      temperature,
      outcome: "created",
      openedEpisodeId: null,
      invalidatedRelease: false,
      message: "演示数据",
      recordedAt: at,
    };
    return rec;
  };

  // 正常：HORSE-18 / HORSE-55 四蹄齐测
  put("HORSE-18", "LF", 37.2, t0);
  put("HORSE-18", "RF", 37.0, t0 + 1 * minute);
  put("HORSE-18", "LH", 36.8, t0 + 2 * minute);
  put("HORSE-18", "RH", 36.9, t0 + 3 * minute);
  put("HORSE-55", "LF", 37.5, t0 + 4 * minute);
  put("HORSE-55", "RF", 37.6, t0 + 5 * minute);
  put("HORSE-55", "LH", 37.4, t0 + 6 * minute);
  put("HORSE-55", "RH", 37.5, t0 + 7 * minute);

  // 预警①：HORSE-27 左前蹄 39.2℃ 单蹄超温 → 观察中（已处置 1 次，复测 1 次仍异常）
  put("HORSE-27", "LF", 39.2, t0 + 8 * minute);
  put("HORSE-27", "RF", 37.1, t0 + 9 * minute);
  const ep1Opened = t0 + 10 * minute;
  const ep1: ObservationEpisode = {
    id: uid("ep"),
    horseId: "HORSE-27",
    date: today,
    trigger: { kind: "SINGLE_HIGH", detail: "左前蹄 39.2℃ 超过 38.5℃ 上限" },
    openedAt: ep1Opened,
    reopenedAt: null,
    status: "active",
    treatments: [
      {
        id: uid("tr"),
        at: ep1Opened + 15 * minute,
        method: "冰水冷敷",
        note: "左前蹄冰敷 15 分钟，间隔 30 分钟复测",
      },
    ],
    rechecks: [
      {
        id: uid("rk"),
        at: ep1Opened + 45 * minute,
        temps: { LF: 38.9, RF: 37.0, LH: 36.9, RH: 37.0 },
        normal: false,
        detail: "左前蹄 38.9℃ 超过 38.5℃ 上限",
      },
    ],
    releases: [],
    updatedAt: ep1Opened + 45 * minute,
  };
  episodes.push(ep1);

  // 预警②：HORSE-31 左右前蹄温差 1.8℃ → 观察中（尚未记录降温处置）
  put("HORSE-31", "LF", 38.1, t0 + 20 * minute);
  put("HORSE-31", "RF", 36.3, t0 + 21 * minute);
  const ep2Opened = t0 + 22 * minute;
  episodes.push({
    id: uid("ep"),
    horseId: "HORSE-31",
    date: today,
    trigger: { kind: "FRONT_DIFF", detail: "左右前蹄温差 1.8℃ 超过 1.5℃ 上限" },
    openedAt: ep2Opened,
    reopenedAt: null,
    status: "active",
    treatments: [],
    rechecks: [],
    releases: [],
    updatedAt: ep2Opened,
  });

  return { records, episodes, submissions };
}

/* ---------------- 存储 ---------------- */

class HoofStore {
  private state: HoofState;
  private listeners = new Set<() => void>();

  constructor() {
    const stored = load();
    this.state = stored ?? persist(seedState());
    if (typeof window !== "undefined") {
      // 其他标签页写入后同步，保证列表 / 训练名单 / 状态一致
      window.addEventListener("storage", (e) => {
        if (e.key !== STORAGE_KEY) return;
        const fresh = load();
        if (fresh) {
          this.state = fresh;
          this.emit();
        }
      });
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = (): HoofState => this.state;

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  /** 所有变更统一入口：先读最新持久化状态，变更后合并写回 */
  private mutate(fn: (draft: HoofState) => void): void {
    const draft = structuredClone(load() ?? this.state);
    fn(draft);
    this.state = persist(draft);
    this.emit();
  }

  /**
   * 提交蹄温（幂等）。
   * 同一 submissionKey 的重复/并发提交直接返回首次结果，不产生新记录。
   * 同一 (马,蹄位,日期) 再次提交视为更正：旧记录留档，且该马当日已解除的观察立即失效重开。
   */
  submitTemperature(input: {
    submissionKey: string;
    horseId: string;
    hoof: HoofPosition;
    date: string;
    temperature: number;
  }): SubmitOutcome {
    const fresh = load() ?? this.state;
    const dup = fresh.submissions[input.submissionKey];
    if (dup) return { result: dup, deduplicated: true };

    let result: SubmissionResult | null = null;

    this.mutate((draft) => {
      const now = tick();
      const recordId = uid("rec");

      // 1. 同键旧有效记录作废（更正留档）
      const prev = draft.records.find(
        (r) =>
          r.effective &&
          r.horseId === input.horseId &&
          r.hoof === input.hoof &&
          r.date === input.date
      );
      const outcome: SubmissionResult["outcome"] = prev ? "corrected" : "created";
      if (prev) {
        prev.effective = false;
        prev.supersededBy = recordId;
      }

      // 2. 原蹄温更正 → 同马同日观察的旧解除立即失效（留档），观察重开
      let invalidatedRelease = false;
      if (prev) {
        for (const ep of draft.episodes) {
          if (
            ep.horseId === input.horseId &&
            ep.date === input.date &&
            ep.status === "released"
          ) {
            ep.status = "active";
            ep.reopenedAt = now;
            ep.updatedAt = now;
            const last = ep.releases[ep.releases.length - 1];
            if (last && last.invalidatedAt === null) {
              last.invalidatedAt = now;
              last.invalidReason = `原蹄温已更正（${HOOF_LABELS[input.hoof]} ${input.date}），旧解除失效`;
            }
            invalidatedRelease = true;
          }
        }
      }

      // 3. 写入新有效记录
      draft.records.push({
        id: recordId,
        horseId: input.horseId,
        hoof: input.hoof,
        date: input.date,
        temperature: input.temperature,
        recordedAt: now,
        effective: true,
        supersededBy: null,
        submissionKey: input.submissionKey,
      });

      // 4. 以当日有效蹄温评估是否触发蹄叶炎观察
      const trigger = evaluateDayTemps(
        effectiveTempsFor(draft.records, input.horseId, input.date)
      );
      let openedEpisodeId: string | null = null;
      const alreadyObserved = draft.episodes.some(
        (ep) => ep.horseId === input.horseId && ep.status === "active"
      );
      if (trigger && !alreadyObserved) {
        const ep: ObservationEpisode = {
          id: uid("ep"),
          horseId: input.horseId,
          date: input.date,
          trigger,
          openedAt: now,
          reopenedAt: null,
          status: "active",
          treatments: [],
          rechecks: [],
          releases: [],
          updatedAt: now,
        };
        draft.episodes.push(ep);
        openedEpisodeId = ep.id;
      }

      // 5. 结果文案
      const parts: string[] = [];
      parts.push(
        outcome === "created"
          ? `${HOOF_LABELS[input.hoof]} ${input.temperature.toFixed(1)}℃ 已记录`
          : `${HOOF_LABELS[input.hoof]} 已更正为 ${input.temperature.toFixed(1)}℃，旧记录留档`
      );
      if (invalidatedRelease) parts.push("原解除已失效，观察重新开启");
      if (openedEpisodeId) parts.push(`触发蹄叶炎预警（${trigger!.detail}），已禁止当日训练`);
      else if (!trigger) parts.push("未触发预警");
      else parts.push("该马仍在观察中");

      // 6. 幂等日志
      result = {
        submissionKey: input.submissionKey,
        recordId,
        horseId: input.horseId,
        hoof: input.hoof,
        date: input.date,
        temperature: input.temperature,
        outcome,
        openedEpisodeId,
        invalidatedRelease,
        message: parts.join("；"),
        recordedAt: now,
      };
      draft.submissions[input.submissionKey] = result;
    });

    return { result: result!, deduplicated: false };
  }

  /** 观察期内记录降温处置 */
  addTreatment(episodeId: string, method: string, note: string): void {
    this.mutate((draft) => {
      const ep = draft.episodes.find((e) => e.id === episodeId);
      if (!ep || ep.status !== "active") return;
      ep.treatments.push({ id: uid("tr"), at: tick(), method, note });
      ep.updatedAt = tick();
    });
  }

  /** 观察期内复测四蹄温度，自动判定正常/异常 */
  addRecheck(
    episodeId: string,
    temps: Partial<Record<HoofPosition, number>>
  ): void {
    this.mutate((draft) => {
      const ep = draft.episodes.find((e) => e.id === episodeId);
      if (!ep || ep.status !== "active") return;
      const trigger = evaluateDayTemps(temps);
      ep.rechecks.push({
        id: uid("rk"),
        at: tick(),
        temps,
        normal: trigger === null,
        detail: trigger ? trigger.detail : "四蹄复测均在正常范围",
      });
      ep.updatedAt = tick();
    });
  }

  /** 解除观察：仅当已记录降温处置且连续两次复测正常 */
  releaseEpisode(episodeId: string): boolean {
    let ok = false;
    this.mutate((draft) => {
      const ep = draft.episodes.find((e) => e.id === episodeId);
      if (!ep || !canRelease(ep)) return;
      const now = tick();
      ep.status = "released";
      ep.releases.push({ at: now, invalidatedAt: null, invalidReason: null });
      ep.updatedAt = now;
      ok = true;
    });
    return ok;
  }

  /** 清空并恢复演示数据 */
  resetToSeed(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.state = persist(seedState());
    this.emit();
  }
}

export const hoofStore = new HoofStore();
