// 蹄温录入面板：选择马匹/日期/蹄位录入初测；重复提交沿用首次结果；
// 已存在有效蹄温时走“更正”，更正会失效旧解除并留档。

import { useMemo, useState } from "react";
import {
  HOOFS,
  HOOF_LABEL,
  isActiveDailyRecord,
} from "../domain/rules";
import type { Hoof } from "../domain/types";
import { DomainError } from "../domain/types";
import { repo, type SubmitOutcome, type CorrectOutcome } from "../storage/repository";
import { newToken, useRootState } from "../storage/store";

interface Props {
  date: string;
  onDateChange: (d: string) => void;
  onResult: (msg: string, kind: "ok" | "warn" | "err") => void;
}

export function TemperatureEntry({ date, onDateChange, onResult }: Props) {
  const state = useRootState();
  const [horseId, setHorseId] = useState(state.horses[0]?.id ?? "");
  const [hoof, setHoof] = useState<Hoof>("LF");
  const [temperature, setTemperature] = useState("");
  const [note, setNote] = useState("");
  const [token, setToken] = useState(() => newToken());
  const [busy, setBusy] = useState(false);

  const dayRecords = useMemo(
    () =>
      state.tempRecords
        .filter((r) => r.horseId === horseId && r.date === date)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [state.tempRecords, horseId, date]
  );
  const activeForHoof = dayRecords.find(
    (r) => r.hoof === hoof && isActiveDailyRecord(r)
  );

  function resetForm(t: string) {
    setTemperature("");
    setNote("");
    setToken(t);
  }

  async function submit() {
    const value = Number(temperature);
    if (!temperature.trim() || !Number.isFinite(value)) {
      onResult("请输入有效蹄温", "err");
      return;
    }
    setBusy(true);
    try {
      const myToken = token;
      const out: SubmitOutcome = await repo.submitTemp({
        horseId,
        date,
        hoof,
        temperature: value,
        clientToken: myToken,
        note: note.trim() || undefined,
      });
      if (out.duplicate) {
        onResult(
          `重复提交：${HOOF_LABEL[hoof]}当日已有有效蹄温 ${out.temperature.toFixed(
            1
          )}℃，沿用首次结果；本次记录已归档留痕。`,
          "warn"
        );
      } else if (out.abnormal) {
        onResult(
          `已记录 ${out.temperature.toFixed(
            1
          )}℃，触发蹄叶炎观察：${out.reasons.join("；")}。禁止列入当日训练。`,
          "err"
        );
      } else {
        onResult(`已记录 ${HOOF_LABEL[hoof]} ${out.temperature.toFixed(1)}℃，暂未越线。`, "ok");
      }
      resetForm(newToken());
    } catch (e) {
      onResult(e instanceof DomainError ? e.message : "提交失败", "err");
    } finally {
      setBusy(false);
    }
  }

  async function correct() {
    if (!activeForHoof) return;
    const value = Number(temperature);
    if (!temperature.trim() || !Number.isFinite(value)) {
      onResult("请输入更正后的蹄温", "err");
      return;
    }
    setBusy(true);
    try {
      const out: CorrectOutcome = await repo.correctTemp({
        recordId: activeForHoof.id,
        temperature: value,
        clientToken: token,
        note: note.trim() || undefined,
      });
      if (out.releaseRevoked) {
        onResult(
          `已更正为 ${out.temperature.toFixed(
            1
          )}℃：旧解除立即失效，须重新降温并连续两次复测正常。原记录已留档。`,
          "err"
        );
      } else if (out.abnormal) {
        onResult(
          `已更正为 ${out.temperature.toFixed(
            1
          )}℃，触发/维持蹄叶炎观察：${out.reasons.join("；")}。`,
          "warn"
        );
      } else {
        onResult(
          `已更正为 ${out.temperature.toFixed(
            1
          )}℃；如该马处在观察中，仍需完成复测闭环才能解除。`,
          "ok"
        );
      }
      resetForm(newToken());
    } catch (e) {
      onResult(e instanceof DomainError ? e.message : "更正失败", "err");
    } finally {
      setBusy(false);
    }
  }

  async function simulateConcurrent() {
    // 并发提交演示：同一业务键、两个不同提交同时发出 => 只有首次生效
    setBusy(true);
    try {
      const t1 = newToken();
      const t2 = newToken();
      const [a] = await Promise.all([
        repo.submitTemp({
          horseId,
          date,
          hoof,
          temperature: 39.2,
          clientToken: t1,
          note: "并发提交 A",
        }),
        repo.submitTemp({
          horseId,
          date,
          hoof,
          temperature: 36.5,
          clientToken: t2,
          note: "并发提交 B",
        }),
      ]);
      const winner = a.accepted ? "A(39.2℃)" : "B(36.5℃)";
      const loser = a.accepted ? "B" : "A";
      onResult(
        `并发结果：首次提交 ${winner} 生效，${loser} 作为重复归档，两次请求返回同一有效蹄温 ${a.temperature.toFixed(
          1
        )}℃。`,
        a.accepted && a.abnormal ? "err" : "warn"
      );
      resetForm(newToken());
    } catch (e) {
      onResult(e instanceof DomainError ? e.message : "并发演示失败", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>蹄温录入</p>
          <h2>每蹄每日一条有效蹄温</h2>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          aria-label="业务日期"
        />
      </div>

      <div className="entry-grid">
        <label>
          <span>马匹</span>
          <select value={horseId} onChange={(e) => setHorseId(e.target.value)}>
            {state.horses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.id} · {h.name}（{h.stable}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>蹄位</span>
          <select value={hoof} onChange={(e) => setHoof(e.target.value as Hoof)}>
            {HOOFS.map((h) => (
              <option key={h} value={h}>
                {HOOF_LABEL[h]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>蹄温（℃，阈值 38.5 / 前蹄差 1.5）</span>
          <input
            type="number"
            step="0.1"
            min="30"
            max="45"
            placeholder="例如 37.8"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
          />
        </label>
        <label className="span-2">
          <span>备注</span>
          <input
            placeholder="测温方式、环境、处置说明等"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      <div className="entry-actions">
        <button className="primary" onClick={submit} disabled={busy}>
          提交蹄温
        </button>
        <button onClick={correct} disabled={busy || !activeForHoof} title="旧记录留档，新记录生效">
          {activeForHoof
            ? `更正现有蹄温（${activeForHoof.temperature.toFixed(1)}℃）`
            : "更正（当日该蹄无有效记录）"}
        </button>
        <button onClick={simulateConcurrent} disabled={busy}>
          模拟并发提交
        </button>
      </div>

      <div className="day-records">
        <h3>该马当日蹄温流水（含归档）</h3>
        {dayRecords.length === 0 && <p className="muted">暂无记录</p>}
        <ul>
          {dayRecords.map((r) => (
            <li key={r.id} className={r.supersededAt ? "is-superseded" : ""}>
              <b>{HOOF_LABEL[r.hoof]}</b>
              <span>{r.temperature.toFixed(1)}℃</span>
              <span className="muted">
                {r.source === "initial"
                  ? "初测"
                  : r.source === "correction"
                    ? `更正${r.correctionOf ? `（替 ${r.correctionOf.slice(-6)}）` : ""}`
                    : "复测"}
              </span>
              {r.supersededAt && (
                <span className="tag tag-muted">
                  {r.supersededReason === "duplicate" ? "重复归档" : "已被更正"}
                </span>
              )}
              {r.note && <span className="muted note">{r.note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
