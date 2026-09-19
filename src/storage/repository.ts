// 记录存储层：localStorage 持久化 + 串行写队列 + 提交幂等。
// 只负责记录的存取与提交一致性；阈值/观察/解除判断全部调用 domain/rules 纯函数。

import {
  activeEpisodeFor,
  dailyEffectiveRecords,
  evaluateTemps,
  isUnderObservation,
  normalStreak,
  releaseSatisfied,
} from "../domain/rules";
import type {
  EpisodeEvent,
  Hoof,
  ObservationEpisode,
  ReleaseEvent,
  RequestResult,
  RootState,
  TempRecord,
} from "../domain/types";
import { DomainError } from "../domain/types";
import { isoNow } from "../lib/time";
import { buildSeed } from "./seed";

const STORAGE_KEY = "hoof-temp-guardian:v1";
export const OPERATOR = "蹄铁师·值班";
const LATENCY_MS = 220;

// ---- 首次提交结果快照：重复 / 并发 / 刷新后重放同一结果 ----

export interface SubmitOutcome {
  duplicate: boolean;
  accepted: boolean;
  recordId: string;
  archivedRecordId?: string;
  horseId: string;
  date: string;
  hoof: Hoof;
  temperature: number;
  abnormal: boolean;
  reasons: string[];
  episodeId?: string;
  episodeStatus?: "observing" | "released";
}

export interface CorrectOutcome {
  duplicate: boolean;
  recordId: string;
  correctedRecordId: string;
  horseId: string;
  date: string;
  hoof: Hoof;
  temperature: number;
  abnormal: boolean;
  reasons: string[];
  episodeId?: string;
  episodeStatus?: "observing" | "released";
  releaseRevoked: boolean;
  revokedReleaseId?: string;
}

export interface CoolingOutcome {
  duplicate: boolean;
  eventId: string;
  episodeId: string;
}

export interface RecheckOutcome {
  duplicate: boolean;
  eventId: string;
  episodeId: string;
  normal: boolean;
  reasons: string[];
  streak: number;
  released: boolean;
  releaseId?: string;
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function loadState(): RootState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RootState;
      if (parsed && Array.isArray(parsed.horses)) return parsed;
    }
  } catch {
    // 存档损坏时回退到演示数据
  }
  const seed = buildSeed();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  } catch {
    // 无痕模式等场景下仅内存可用
  }
  return seed;
}

export class HoofTempRepository {
  private state: RootState;
  /** 串行队列：所有写操作按到达顺序执行，保证并发提交结果一致 */
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor() {
    this.state = loadState();
  }

  getState(): RootState {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 忽略持久化失败，内存状态仍一致
    }
    this.listeners.forEach((fn) => fn());
  }

  resetDemoData(): RootState {
    this.state = buildSeed();
    this.persist();
    return this.state;
  }

  // ---- 内部工具 ----

  private remember<T>(
    token: string,
    kind: RequestResult["kind"],
    outcome: T
  ): T {
    this.state.requestIndex[token] = { kind, at: isoNow(), outcome };
    return outcome;
  }

  /** 把一个写操作排入串行队列；业务失败也不中断队列 */
  private enqueue<T>(task: () => T): Promise<T> {
    const run = this.chain.then(() => task());
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * 串行执行写操作；若令牌已存在结果（重复提交 / 并发后到 / 刷新后重试），
   * 不执行业务逻辑，直接返回首次结果。
   */
  private replayOrRun<T>(token: string, run: () => T): Promise<T> {
    return this.enqueue(() => {
      const hit = this.state.requestIndex[token];
      if (hit) return hit.outcome as T;
      return run();
    });
  }

  private assertTemp(temperature: number): void {
    if (!Number.isFinite(temperature) || temperature < 30 || temperature > 45) {
      throw new DomainError("蹄温需在 30.0～45.0℃ 之间");
    }
  }

  private assertHorseDate(horseId: string, date: string): void {
    if (!this.state.horses.some((h) => h.id === horseId)) {
      throw new DomainError("马匹不存在");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new DomainError("日期格式应为 YYYY-MM-DD");
    }
  }

  private dayTemps(
    horseId: string,
    date: string
  ): Partial<Record<Hoof, number>> {
    return Object.fromEntries(
      dailyEffectiveRecords(this.state.tempRecords, horseId, date).map((r) => [
        r.hoof,
        r.temperature,
      ])
    ) as Partial<Record<Hoof, number>>;
  }

  /**
   * 重新评估某马某日的观察档案（新增/更正蹄温后调用）。
   * 异常 => 无档案则新建；有已解除档案则重开并失效旧解除。
   * 正常 => 不新建，也不自动关闭已有档案（只能靠复测闭环解除）。
   */
  private reconcileEpisode(
    horseId: string,
    date: string
  ): ObservationEpisode | undefined {
    const effective = dailyEffectiveRecords(this.state.tempRecords, horseId, date);
    const temps: Partial<Record<Hoof, number>> = {};
    effective.forEach((r) => {
      temps[r.hoof] = r.temperature;
    });
    const reasons = evaluateTemps(temps);

    let ep = this.state.episodes.find(
      (e) => e.horseId === horseId && e.triggerDate === date
    );

    if (ep) {
      ep.sourceRecordIds = effective.map((r) => r.id);
      if (reasons.length > 0) ep.reasons = reasons;
    }

    if (reasons.length === 0) {
      return ep && isUnderObservation(ep, this.state.events) ? ep : undefined;
    }

    if (!ep) {
      ep = {
        id: uid("ep"),
        horseId,
        triggerDate: date,
        sourceRecordIds: effective.map((r) => r.id),
        reasons,
        status: "observing",
        openedAt: isoNow(),
      };
      this.state.episodes.push(ep);
      return ep;
    }

    if (!isUnderObservation(ep, this.state.events) && ep.activeReleaseId) {
      // 已解除后当日新蹄温再次越线：重开观察，旧解除立即失效
      const rel = this.state.events.find(
        (e) => e.id === ep!.activeReleaseId
      ) as ReleaseEvent | undefined;
      if (rel && rel.active) {
        rel.active = false;
        rel.revokedAt = isoNow();
        rel.revokeReason = "当日新增蹄温重新触发预警，旧解除立即失效";
        this.state.events.push({
          kind: "revocation",
          id: uid("rev"),
          episodeId: ep.id,
          at: isoNow(),
          releaseId: rel.id,
          correctedRecordId: "",
          newTriggerReasons: reasons,
        });
      }
      ep.status = "observing";
      ep.activeReleaseId = undefined;
    }
    return ep;
  }

  /** 连续两次复测正常且已降温 => 自动解除 */
  private maybeAutoRelease(ep: ObservationEpisode): ReleaseEvent | undefined {
    if (!isUnderObservation(ep, this.state.events)) return undefined;
    if (!releaseSatisfied(ep, this.state.events)) return undefined;

    const rechecks = this.state.events
      .filter((e) => e.episodeId === ep.id && e.kind === "recheck")
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-2) as Extract<EpisodeEvent, { kind: "recheck" }>[];

    const release: ReleaseEvent = {
      kind: "release",
      id: uid("rel"),
      episodeId: ep.id,
      at: isoNow(),
      afterRecheckIds: [rechecks[0].id, rechecks[1].id],
      active: true,
    };
    this.state.events.push(release);
    ep.status = "released";
    ep.activeReleaseId = release.id;
    return release;
  }

  // ---- 对外操作 ----

  /**
   * 提交当日蹄温（初测）。
   * 同马同日同蹄已被有效记录占用时，新提交作为重复归档，结果沿用首次。
   */
  submitTemp(input: {
    horseId: string;
    date: string;
    hoof: Hoof;
    temperature: number;
    clientToken: string;
    note?: string;
  }): Promise<SubmitOutcome> {
    return this.replayOrRun(input.clientToken, () => {
      this.assertHorseDate(input.horseId, input.date);
      this.assertTemp(input.temperature);

      const existing = this.state.tempRecords.find(
        (r) =>
          r.horseId === input.horseId &&
          r.date === input.date &&
          r.hoof === input.hoof &&
          (r.source === "initial" || r.source === "correction") &&
          !r.supersededAt
      );

      let outcome: SubmitOutcome;

      if (existing) {
        // 重复提交：新记录留档但不生效，结果沿用首次
        const dup: TempRecord = {
          id: uid("rec"),
          horseId: input.horseId,
          date: input.date,
          hoof: input.hoof,
          temperature: input.temperature,
          source: "initial",
          clientToken: input.clientToken,
          createdAt: isoNow(),
          createdBy: OPERATOR,
          note: input.note,
          supersededAt: isoNow(),
          supersededReason: "duplicate",
          supersededBy: existing.clientToken,
        };
        this.state.tempRecords.push(dup);

        const reasons = evaluateTemps(this.dayTemps(input.horseId, input.date));
        const ep = activeEpisodeFor(
          this.state.episodes,
          this.state.events,
          input.horseId,
          input.date
        );
        outcome = {
          duplicate: true,
          accepted: false,
          recordId: existing.id,
          archivedRecordId: dup.id,
          horseId: input.horseId,
          date: input.date,
          hoof: input.hoof,
          temperature: existing.temperature,
          abnormal: reasons.length > 0,
          reasons,
          episodeId: ep?.id,
          episodeStatus: ep?.status,
        };
      } else {
        const rec: TempRecord = {
          id: uid("rec"),
          horseId: input.horseId,
          date: input.date,
          hoof: input.hoof,
          temperature: input.temperature,
          source: "initial",
          clientToken: input.clientToken,
          createdAt: isoNow(),
          createdBy: OPERATOR,
          note: input.note,
        };
        this.state.tempRecords.push(rec);
        const ep = this.reconcileEpisode(input.horseId, input.date);
        const reasons = evaluateTemps(this.dayTemps(input.horseId, input.date));
        outcome = {
          duplicate: false,
          accepted: true,
          recordId: rec.id,
          horseId: input.horseId,
          date: input.date,
          hoof: input.hoof,
          temperature: input.temperature,
          abnormal: reasons.length > 0,
          reasons,
          episodeId: ep?.id,
          episodeStatus: ep?.status,
        };
      }

      this.remember(input.clientToken, "submit", outcome);
      this.persist();
      return outcome;
    }).then(delay);
  }

  /**
   * 更正蹄温：旧记录留档失效，新记录生效。
   * 更正触发日原蹄温：旧解除立即失效，连续复测计数清零，须重新走完整闭环。
   */
  correctTemp(input: {
    recordId: string;
    temperature: number;
    clientToken: string;
    note?: string;
  }): Promise<CorrectOutcome> {
    return this.replayOrRun(input.clientToken, () => {
      this.assertTemp(input.temperature);
      const old = this.state.tempRecords.find((r) => r.id === input.recordId);
      if (!old || old.supersededAt) {
        throw new DomainError("原蹄温记录不存在或已失效，无法更正");
      }
      if (old.source !== "initial" && old.source !== "correction") {
        throw new DomainError("复测记录不属于当日蹄温，不能在此更正");
      }
      const newer = this.state.tempRecords.find(
        (r) => r.correctionOf === old.id && !r.supersededAt
      );
      if (newer) {
        throw new DomainError("该蹄温已有更新的更正，请更正最新一条记录");
      }

      const now = isoNow();
      old.supersededAt = now;
      old.supersededReason = "correction";
      old.supersededBy = input.clientToken;

      const fixed: TempRecord = {
        id: uid("rec"),
        horseId: old.horseId,
        date: old.date,
        hoof: old.hoof,
        temperature: input.temperature,
        source: "correction",
        clientToken: input.clientToken,
        createdAt: now,
        createdBy: OPERATOR,
        note: input.note,
        correctionOf: old.id,
      };
      this.state.tempRecords.push(fixed);

      const dayEp = this.state.episodes.find(
        (e) => e.horseId === old.horseId && e.triggerDate === old.date
      );

      // 原蹄温更正 => 旧解除立即失效（历史留档，不删除）
      let releaseRevoked = false;
      let revokedReleaseId: string | undefined;
      if (dayEp?.activeReleaseId) {
        const rel = this.state.events.find(
          (e) => e.id === dayEp.activeReleaseId
        ) as ReleaseEvent | undefined;
        if (rel?.active) {
          rel.active = false;
          rel.revokedAt = now;
          rel.revokeReason = `原蹄温更正：${old.temperature.toFixed(
            1
          )}℃ 更正为 ${input.temperature.toFixed(1)}℃，旧解除立即失效`;
          this.state.events.push({
            kind: "revocation",
            id: uid("rev"),
            episodeId: dayEp.id,
            at: now,
            releaseId: rel.id,
            correctedRecordId: fixed.id,
            newTriggerReasons: dayEp.reasons,
          });
          dayEp.status = "observing";
          dayEp.activeReleaseId = undefined;
          releaseRevoked = true;
          revokedReleaseId = rel.id;
        }
      }

      // 重新评估当日观察档案（异常可能新增/消失；档案不会因更正自动关闭）
      const ep = this.reconcileEpisode(old.horseId, old.date);
      const currentEp = ep ?? dayEp;
      const reasons = evaluateTemps(this.dayTemps(old.horseId, old.date));

      const outcome: CorrectOutcome = {
        duplicate: false,
        recordId: fixed.id,
        correctedRecordId: old.id,
        horseId: old.horseId,
        date: old.date,
        hoof: old.hoof,
        temperature: input.temperature,
        abnormal: reasons.length > 0,
        reasons,
        episodeId: currentEp?.id,
        episodeStatus: currentEp?.status,
        releaseRevoked,
        revokedReleaseId,
      };
      this.remember(input.clientToken, "correct", outcome);
      this.persist();
      return outcome;
    }).then(delay);
  }

  /** 观察记录：降温处置（解除前置条件） */
  recordCooling(input: {
    episodeId: string;
    action: string;
    note?: string;
    clientToken: string;
  }): Promise<CoolingOutcome> {
    return this.replayOrRun(input.clientToken, () => {
      const ep = this.state.episodes.find((e) => e.id === input.episodeId);
      if (!ep) throw new DomainError("观察档案不存在");
      if (!isUnderObservation(ep, this.state.events)) {
        throw new DomainError("该观察档案已解除，无需再记录降温");
      }
      if (!input.action.trim()) throw new DomainError("请填写降温处置措施");

      const ev: Extract<EpisodeEvent, { kind: "cooling" }> = {
        kind: "cooling",
        id: uid("cool"),
        episodeId: ep.id,
        at: isoNow(),
        action: input.action.trim(),
        note: input.note?.trim() || undefined,
        clientToken: input.clientToken,
      };
      this.state.events.push(ev);
      const outcome: CoolingOutcome = {
        duplicate: false,
        eventId: ev.id,
        episodeId: ep.id,
      };
      this.remember(input.clientToken, "cooling", outcome);
      this.persist();
      return outcome;
    }).then(delay);
  }

  /**
   * 观察复测：记录各蹄温度。须先有降温处置。
   * 锚点（建档 / 最近一次解除失效）起连续两次复测正常 => 自动解除。
   */
  recordRecheck(input: {
    episodeId: string;
    temperatures: Partial<Record<Hoof, number>>;
    clientToken: string;
  }): Promise<RecheckOutcome> {
    return this.replayOrRun(input.clientToken, () => {
      const ep = this.state.episodes.find((e) => e.id === input.episodeId);
      if (!ep) throw new DomainError("观察档案不存在");
      if (!isUnderObservation(ep, this.state.events)) {
        throw new DomainError("该观察档案已解除，不能再复测");
      }
      const measured = Object.entries(input.temperatures) as [Hoof, number][];
      if (measured.length === 0) throw new DomainError("请至少复测一个蹄位");
      measured.forEach(([, t]) => this.assertTemp(t));

      const hasCool = this.state.events.some(
        (e) => e.episodeId === ep.id && e.kind === "cooling"
      );
      if (!hasCool) throw new DomainError("复测前必须先记录降温处置");

      const now = isoNow();
      const recordIds: string[] = [];
      for (const [hoof, temperature] of measured) {
        const r: TempRecord = {
          id: uid("rec"),
          horseId: ep.horseId,
          date: ep.triggerDate,
          hoof,
          temperature,
          source: "recheck",
          clientToken: input.clientToken,
          createdAt: now,
          createdBy: OPERATOR,
          note: "观察复测",
          recheckId: "",
        };
        this.state.tempRecords.push(r);
        recordIds.push(r.id);
      }

      const reasons = evaluateTemps(input.temperatures);
      const rc: Extract<EpisodeEvent, { kind: "recheck" }> = {
        kind: "recheck",
        id: uid("rc"),
        episodeId: ep.id,
        at: now,
        temperatures: input.temperatures,
        normal: reasons.length === 0,
        reasons,
        recordIds,
        clientToken: input.clientToken,
      };
      // 回填 recheckId 关联
      recordIds.forEach((id) => {
        const r = this.state.tempRecords.find((x) => x.id === id);
        if (r) r.recheckId = rc.id;
      });
      this.state.events.push(rc);

      const release = this.maybeAutoRelease(ep);
      const outcome: RecheckOutcome = {
        duplicate: false,
        eventId: rc.id,
        episodeId: ep.id,
        normal: rc.normal,
        reasons,
        streak: normalStreak(ep, this.state.events),
        released: Boolean(release),
        releaseId: release?.id,
      };
      this.remember(input.clientToken, "recheck", outcome);
      this.persist();
      return outcome;
    }).then(delay);
  }
}

/** 单例仓储：列表、训练名单、所有页面入口共享同一份状态 */
export const repo = new HoofTempRepository();
