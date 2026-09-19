// 展示层共用小组件：只负责渲染，不做业务判断。

import type { Hoof } from "../domain/types";
import {
  FRONT_DIFF_MAX,
  HOOF_LABEL,
  SINGLE_HOOF_MAX,
  fmtTemp,
  frontDiff,
} from "../domain/rules";
import type { TrainingGate } from "../domain/rules";

export function HoofTempCell({
  hoof,
  value,
}: {
  hoof: Hoof;
  value: number | undefined;
}) {
  const hot = value !== undefined && value > SINGLE_HOOF_MAX;
  return (
    <div className={`hoof-cell ${hot ? "is-hot" : ""} ${value === undefined ? "is-empty" : ""}`}>
      <small>{HOOF_LABEL[hoof]}</small>
      <strong>{fmtTemp(value)}</strong>
    </div>
  );
}

export function FrontDiffBadge({
  temps,
}: {
  temps: Partial<Record<Hoof, number>>;
}) {
  const diff = frontDiff(temps);
  if (diff === undefined) return <span className="tag tag-muted">前蹄温差 —</span>;
  const over = diff > FRONT_DIFF_MAX;
  return (
    <span className={`tag ${over ? "tag-danger" : "tag-ok"}`}>
      前蹄温差 {diff.toFixed(1)}℃{over ? ` >${FRONT_DIFF_MAX}℃` : ""}
    </span>
  );
}

const GATE_TEXT: Record<TrainingGate, { text: string; cls: string }> = {
  blocked: { text: "蹄叶炎观察 · 禁止训练", cls: "tag-danger" },
  pending: { text: "蹄温未测齐 · 待补测", cls: "tag-warn" },
  cleared: { text: "可列入当日训练", cls: "tag-ok" },
};

export function GateBadge({ gate }: { gate: TrainingGate }) {
  const g = GATE_TEXT[gate];
  return <span className={`tag ${g.cls}`}>{g.text}</span>;
}
