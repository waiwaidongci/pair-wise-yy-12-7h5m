import { useState } from "react";
import {
  HOOF_LABELS,
  HOOF_ORDER,
  todayStr,
  type HoofPosition,
} from "../domain/hoofDomain";
import { HORSES } from "../domain/roster";
import { hoofStore, type SubmitOutcome } from "../storage/hoofStore";

function newSubmissionKey(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return `sub-${rnd}`;
}

/**
 * 蹄温录入 / 更正。
 * 提交凭证在表单值变化时才重新生成：值未变的重复点击（含双击、并发重试）
 * 会携带同一凭证，存储层直接沿用首次结果。
 */
export function TemperatureForm() {
  const [horseId, setHorseId] = useState(HORSES[0].id);
  const [hoof, setHoof] = useState<HoofPosition>("LF");
  const [date, setDate] = useState(todayStr());
  const [temperature, setTemperature] = useState("");
  const [submissionKey, setSubmissionKey] = useState(newSubmissionKey);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 任何字段变化都视为一次新的录入意图 → 换发提交凭证 */
  const onFieldChange = <T,>(setter: (v: T) => void) => {
    return (v: T) => {
      setter(v);
      setSubmissionKey(newSubmissionKey());
      setOutcome(null);
      setError(null);
    };
  };

  const submit = () => {
    const value = Number(temperature);
    if (!date) {
      setError("请选择测量日期");
      return;
    }
    if (date > todayStr()) {
      setError("测量日期不能晚于今天");
      return;
    }
    if (!Number.isFinite(value) || value < 30 || value > 45) {
      setError("蹄温需在 30.0 ~ 45.0 ℃ 之间");
      return;
    }
    const result = hoofStore.submitTemperature({
      submissionKey,
      horseId,
      hoof,
      date,
      temperature: Math.round(value * 10) / 10,
    });
    setOutcome(result);
    setError(null);
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>蹄温录入</p>
          <h2>晨检蹄温登记</h2>
        </div>
        <button className="primary" onClick={submit}>
          提交蹄温
        </button>
      </div>

      <div className="field-grid">
        <label>
          <span>马匹</span>
          <select value={horseId} onChange={(e) => onFieldChange(setHorseId)(e.target.value)}>
            {HORSES.map((h) => (
              <option key={h.id} value={h.id}>
                {h.id} · {h.name}（{h.category}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>蹄位</span>
          <select
            value={hoof}
            onChange={(e) => onFieldChange(setHoof)(e.target.value as HoofPosition)}
          >
            {HOOF_ORDER.map((p) => (
              <option key={p} value={p}>
                {HOOF_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>测量日期</span>
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => onFieldChange(setDate)(e.target.value)}
          />
        </label>
        <label>
          <span>蹄温（℃）</span>
          <input
            type="number"
            step="0.1"
            min="30"
            max="45"
            placeholder="如 37.2"
            value={temperature}
            onChange={(e) => onFieldChange(setTemperature)(e.target.value)}
          />
        </label>
      </div>

      <p className="hint">
        同一马匹 + 同一蹄位 + 同一日期再次提交视为更正，旧记录自动留档；更正会使该马当日
        已解除的观察立即失效。左右前蹄温差 &gt; 1.5℃ 或单蹄 &gt; 38.5℃ 将进入蹄叶炎观察并禁止当日训练。
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {outcome && (
        <div className={`banner ${outcome.result.openedEpisodeId || outcome.result.invalidatedRelease ? "banner-warn" : "banner-ok"}`}>
          <strong>{outcome.deduplicated ? "重复/并发提交，已沿用首次结果：" : "已受理："}</strong>
          {outcome.result.message}
          <small>提交凭证 {outcome.result.submissionKey.slice(0, 13)}…</small>
        </div>
      )}
    </section>
  );
}
