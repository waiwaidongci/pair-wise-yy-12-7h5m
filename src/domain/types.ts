// 领域模型：蹄温预警与蹄叶炎观察闭环
// 本文件只描述数据结构，不含任何判断逻辑与存储逻辑。

/** 蹄位：左前 / 右前 / 左后 / 右后 */
export type Hoof = "LF" | "RF" | "LH" | "RH";

/** 蹄温来源：当日初测 / 对初测的更正 / 观察期复测 */
export type TempSource = "initial" | "correction" | "recheck";

/**
 * 蹄温记录。
 * 业务唯一键（initial / correction 来源）：horseId + date + hoof 只允许一条有效记录。
 * 被取代或被更正的记录不会删除，只置位 superseded* 字段留档。
 */
export interface TempRecord {
  id: string;
  horseId: string;
  /** 当地日期 YYYY-MM-DD */
  date: string;
  hoof: Hoof;
  temperature: number;
  source: TempSource;
  /** 提交令牌：重复或并发提交沿用首次结果 */
  clientToken: string;
  createdAt: string;
  createdBy: string;
  note?: string;
  /** 已失效（重复归档或被更正） */
  supersededAt?: string;
  supersededReason?: "duplicate" | "correction";
  supersededBy?: string;
  /** 本记录更正自哪条记录 */
  correctionOf?: string;
  /** 复测来源时所属的复测事件 */
  recheckId?: string;
}

export type EpisodeStatus = "observing" | "released";

/** 观察期降温处置 */
export interface CoolingEvent {
  kind: "cooling";
  id: string;
  episodeId: string;
  at: string;
  action: string;
  note?: string;
  clientToken: string;
}

/** 观察期复测（一次复测包含若干蹄位的温度） */
export interface RecheckEvent {
  kind: "recheck";
  id: string;
  episodeId: string;
  at: string;
  temperatures: Partial<Record<Hoof, number>>;
  normal: boolean;
  reasons: string[];
  /** 本次复测生成的蹄温记录 id */
  recordIds: string[];
  clientToken: string;
}

/** 解除记录：连续两次复测正常后自动生成；更正原蹄温后立即失效 */
export interface ReleaseEvent {
  kind: "release";
  id: string;
  episodeId: string;
  at: string;
  /** 达成解除的连续两次复测 */
  afterRecheckIds: string[];
  active: boolean;
  revokedAt?: string;
  revokeReason?: string;
}

/** 解除失效审计事件，历史留档 */
export interface RevocationEvent {
  kind: "revocation";
  id: string;
  episodeId: string;
  at: string;
  releaseId: string;
  /** 导致失效的那条更正记录 */
  correctedRecordId: string;
  newTriggerReasons: string[];
}

export type EpisodeEvent =
  | CoolingEvent
  | RecheckEvent
  | ReleaseEvent
  | RevocationEvent;

/**
 * 蹄叶炎观察档案。
 * 同一匹马同一天最多一个观察档案（按 triggerDate 归类）。
 */
export interface ObservationEpisode {
  id: string;
  horseId: string;
  /** 触发日期 = 异常蹄温所属日期 */
  triggerDate: string;
  /** 触发时纳入的当日有效蹄温记录 */
  sourceRecordIds: string[];
  reasons: string[];
  status: EpisodeStatus;
  openedAt: string;
  activeReleaseId?: string;
}

export interface Horse {
  id: string;
  name: string;
  stable: string;
  category: "运动马" | "休养马";
}

/** 幂等索引：clientToken -> 首次提交结果（快照，刷新后仍在） */
export interface RequestResult {
  kind: "submit" | "correct" | "cooling" | "recheck";
  at: string;
  outcome: unknown;
}

export interface RootState {
  horses: Horse[];
  tempRecords: TempRecord[];
  episodes: ObservationEpisode[];
  events: EpisodeEvent[];
  requestIndex: Record<string, RequestResult>;
  seededAt: string;
}

/** 业务规则错误（与网络/存储错误区分，页面可直接展示） */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
