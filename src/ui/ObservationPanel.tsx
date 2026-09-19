import { useState } from "react";
import {
  canRelease,
  releaseBlockers,
  consecutiveNormalRechecks,
  treatmentsInWindow,
  formatTime,
  HOOF_LABELS,
  HOOF_ORDER,
  REQUIRED_CONSECUTIVE_NORMAL_RECHECKS,
  type HoofPosition,
  type ObservationEpisode,
} from "../domain/hoofDomain";
import { horseName } from "../domain/roster";
import { hoofStore } from "../storage/hoofStore";
import { useHoofState } from "./hooks";

const TREATMENT_METHODS = ["冷水冲淋", "冰水冷敷", "冷浴槽浸泡", "药物辅助", "其他"];

function TreatmentForm({ episodeId }: { episodeId: string }) {
  const [method, setMethod] = useState(TREATMENT_METHODS[0]);
  const [note, setNote] = useState("");
  return (
    <div className="inline-form">
      <select value={method} onChange={(e) => setMethod(e.target.value)}>
        {TREATMENT_METHODS.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <input
        placeholder="处置备注（时长 / 部位）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        onClick={() => {
          hoofStore.addTreatment(episodeId, method, note.trim() || "—");
          setNote("");
        }}
      >
        记录处置
      </button>
    </div>
  );
}

function RecheckForm({ episodeId }: { episodeId: string }) {
  const [temps, setTemps] = useState<Record<HoofPosition, string>>({
    LF: "",
    RF: "",
    LH: "",
    RH: "",
  });
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed: Partial<Record<HoofPosition, number>> = {};
    for (const p of HOOF_ORDER) {
      const v = Number(temps[p]);
      if (!Number.isFinite(v) || v < 30 || v > 45) {
        setError(`请填写${HOOF_LABELS[p]}复测温度（30.0 ~ 45.0 ℃）`);
        return;
      }
      parsed[p] = Math.round(v * 10) / 10;
    }
    hoofStore.addRecheck(episodeId, parsed);
    setTemps({ LF: "", RF: "", LH: "", RH: "" });
    setError(null);
  };

  return (
    <div className="recheck-form">
      <div className="temp-grid">
        {HOOF_ORDER.map((p) => (
          <label key={p}>
            <span>{HOOF_LABELS[p]}（℃）</span>
            <input
              type="number"
              step="0.1"
              min="30"
              max="45"
              value={temps[p]}
              onChange={(e) => setTemps({ ...temps, [p]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {error && <p className="hint hint-warn">{error}</p>}
      <button onClick={submit}>提交复测</button>
    </div>
  );
}

function EpisodeCard({ ep }: { ep: ObservationEpisode }) {
  const blockers = releaseBlockers(ep);
  const releasable = canRelease(ep);
  const normalCount = consecutiveNormalRechecks(ep);

  return (
    <article className="episode">
      <div className="horse-head">
        <strong>{horseName(ep.horseId)}</strong>
        <span className="badge badge-ban">蹄叶炎观察中</span>
      </div>
      <p className="hint hint-warn">
        {formatTime(ep.openedAt)} 触发：{ep.trigger.detail}，当日及观察期内禁止训练。
        {ep.reopenedAt && `（${formatTime(ep.reopenedAt)} 因原蹄温更正重新开启）`}
      </p>

      <div className="episode-cols">
        <div>
          <h4>
            降温处置（本窗口 {treatmentsInWindow(ep).length} 次）
          </h4>
          <ul className="log">
            {ep.treatments.map((t) => (
              <li key={t.id}>
                <span>{formatTime(t.at)}</span>
                {t.method} · {t.note}
              </li>
            ))}
            {ep.treatments.length === 0 && <li className="hint">尚未记录降温处置</li>}
          </ul>
          <TreatmentForm episodeId={ep.id} />
        </div>

        <div>
          <h4>
            复测记录（连续正常 {normalCount}/{REQUIRED_CONSECUTIVE_NORMAL_RECHECKS}）
          </h4>
          <ul className="log">
            {ep.rechecks.map((r) => (
              <li key={r.id} className={r.normal ? "" : "log-abnormal"}>
                <span>{formatTime(r.at)}</span>
                {HOOF_ORDER.map((p) => `${HOOF_LABELS[p]} ${r.temps[p]?.toFixed(1) ?? "—"}`).join(" / ")}
                {" · "}
                {r.normal ? "正常" : `异常（${r.detail}）`}
              </li>
            ))}
            {ep.rechecks.length === 0 && <li className="hint">尚无复测记录</li>}
          </ul>
          <RecheckForm episodeId={ep.id} />
        </div>
      </div>

      <div className="episode-footer">
        <button
          className="primary"
          disabled={!releasable}
          onClick={() => hoofStore.releaseEpisode(ep.id)}
        >
          解除观察
        </button>
        {!releasable && <span className="hint">暂不可解除：{blockers.join("；")}</span>}
        {releasable && <span className="hint hint-ok">已满足解除条件：处置已记录，连续两次复测正常。</span>}
      </div>

      {ep.releases.length > 0 && (
        <ul className="log release-log">
          {ep.releases.map((r, i) => (
            <li key={i} className={r.invalidatedAt ? "log-abnormal" : ""}>
              <span>{formatTime(r.at)}</span>
              解除观察
              {r.invalidatedAt && ` · 已于 ${formatTime(r.invalidatedAt)} 失效（${r.invalidReason}）`}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** 蹄叶炎观察闭环：处置 → 复测 → 解除（更正失效留档） */
export function ObservationPanel() {
  const { episodes } = useHoofState();
  const active = episodes.filter((e) => e.status === "active");
  const released = episodes.filter((e) => e.status === "released");

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>闭环管理</p>
          <h2>蹄叶炎观察</h2>
        </div>
        <span className="badge badge-warn">{active.length} 匹观察中</span>
      </div>

      {active.length === 0 && <p className="hint">当前无观察中的马匹。</p>}
      {active.map((ep) => (
        <EpisodeCard key={ep.id} ep={ep} />
      ))}

      {released.length > 0 && (
        <>
          <h3 className="subheading">已解除（历史留档）</h3>
          <ul className="log">
            {released.map((ep) => {
              const validRelease = ep.releases[ep.releases.length - 1];
              return (
                <li key={ep.id}>
                  <span>{formatTime(ep.openedAt)}</span>
                  {horseName(ep.horseId)} · 触发：{ep.trigger.detail} ·{" "}
                  {validRelease ? `${formatTime(validRelease.at)} 解除` : "已解除"}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
