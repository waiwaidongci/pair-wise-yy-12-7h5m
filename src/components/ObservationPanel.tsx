// 蹄叶炎观察闭环面板：
// 降温处置 → 复测 → 连续两次复测正常自动解除；
// 原蹄温更正导致旧解除失效时，时间线完整留档。

import { useMemo, useState } from "react";
import {
  HOOFS,
  HOOF_LABEL,
  episodeTimeline,
  hasCooling,
  isUnderObservation,
  normalStreak,
  streakAnchor,
} from "../domain/rules";
import type { EpisodeEvent, Hoof } from "../domain/types";
import { DomainError } from "../domain/types";
import { repo, type CoolingOutcome, type RecheckOutcome } from "../storage/repository";
import { newToken, useRootState } from "../storage/store";

interface Props {
  date: string;
  onResult: (msg: string, kind: "ok" | "warn" | "err") => void;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function TimelineEntry({ ev }: { ev: EpisodeEvent }) {
  if (ev.kind === "cooling") {
    return (
      <li className="tl tl-cooling">
        <span className="tl-time">{timeLabel(ev.at)}</span>
        <span className="tag tag-info">降温处置</span>
        <span>{ev.action}</span>
        {ev.note && <span className="muted">{ev.note}</span>}
      </li>
    );
  }
  if (ev.kind === "recheck") {
    const temps = HOOFS.filter((h) => ev.temperatures[h] !== undefined)
      .map((h) => `${HOOF_LABEL[h]} ${ev.temperatures[h]!.toFixed(1)}℃`)
      .join(" / ");
    return (
      <li className={`tl ${ev.normal ? "tl-ok" : "tl-bad"}`}>
        <span className="tl-time">{timeLabel(ev.at)}</span>
        <span className={`tag ${ev.normal ? "tag-ok" : "tag-danger"}`}>
          复测{ev.normal ? "正常" : "仍异常"}
        </span>
        <span>{temps}</span>
        {!ev.normal && <span className="muted">{ev.reasons.join("；")}</span>}
      </li>
    );
  }
  if (ev.kind === "release") {
    return (
      <li className={`tl ${ev.active ? "tl-release" : "tl-revoked"}`}>
        <span className="tl-time">{timeLabel(ev.at)}</span>
        <span className={`tag ${ev.active ? "tag-ok" : "tag-muted"}`}>
          {ev.active ? "解除观察" : "解除已失效"}
        </span>
        <span>
          连续两次复测正常
          {!ev.active && ev.revokeReason && (
            <em className="muted"> — {ev.revokeReason}</em>
          )}
        </span>
      </li>
    );
  }
  return (
    <li className="tl tl-revoked">
      <span className="tl-time">{timeLabel(ev.at)}</span>
      <span className="tag tag-danger">旧解除失效</span>
      <span>原蹄温更正，连续复测计数重置，历史留档</span>
    </li>
  );
}

function EpisodeCard({
  episodeId,
  horseName,
  onResult,
}: {
  episodeId: string;
  horseName: string;
  onResult: Props["onResult"];
}) {
  const state = useRootState();
  const ep = state.episodes.find((e) => e.id === episodeId);
  const [action, setAction] = useState("冷水冲蹄 20 分钟");
  const [coolNote, setCoolNote] = useState("");
  const [temps, setTemps] = useState<Partial<Record<Hoof, string>>>({});
  const [busy, setBusy] = useState(false);

  const timeline = useMemo(
    () => (ep ? episodeTimeline(state.events, ep.id) : []),
    [state.events, ep]
  );

  if (!ep) return null;
  const observing = isUnderObservation(ep, state.events);
  const cooled = hasCooling(ep, state.events);
  const streak = normalStreak(ep, state.events);
  const anchor = timeLabel(streakAnchor(ep, state.events));

  async function saveCooling() {
    setBusy(true);
    try {
      const out: CoolingOutcome = await repo.recordCooling({
        episodeId: ep!.id,
        action,
        note: coolNote,
        clientToken: newToken(),
      });
      onResult(`降温处置已记录（${out.eventId.slice(-6)}），可安排复测。`, "ok");
      setCoolNote("");
    } catch (e) {
      onResult(e instanceof DomainError ? e.message : "记录失败", "err");
    } finally {
      setBusy(false);
    }
  }

  async function saveRecheck() {
    const parsed: Partial<Record<Hoof, number>> = {};
    for (const h of HOOFS) {
      const v = temps[h];
      if (v !== undefined && v.trim() !== "") {
        const n = Number(v);
        if (!Number.isFinite(n)) {
          onResult(`${HOOF_LABEL[h]}蹄温无效`, "err");
          return;
        }
        parsed[h] = n;
      }
    }
    if (Object.keys(parsed).length === 0) {
      onResult("请至少填写一个蹄位的复测温度", "err");
      return;
    }
    setBusy(true);
    try {
      const out: RecheckOutcome = await repo.recordRecheck({
        episodeId: ep!.id,
        temperatures: parsed,
        clientToken: newToken(),
      });
      if (out.released) {
        onResult("连续两次复测正常，观察自动解除，该马可恢复训练。", "ok");
      } else if (out.normal) {
        onResult(`复测正常，连续正常 ${out.streak}/2；需再完成一次正常复测。`, "ok");
      } else {
        onResult(`复测仍异常：${out.reasons.join("；")}，连续计数归零。`, "err");
      }
      setTemps({});
    } catch (e) {
      onResult(e instanceof DomainError ? e.message : "复测失败", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`episode-card ${observing ? "is-observing" : "is-released"}`}>
      <header>
        <div>
          <h3>
            {horseName} · {ep.triggerDate}
          </h3>
          <small className="muted">
            档案 {ep.id.slice(-8)} · 建档 {timeLabel(ep.openedAt)}
          </small>
        </div>
        <span className={`tag ${observing ? "tag-danger" : "tag-ok"}`}>
          {observing ? "观察中 · 禁止训练" : "已解除 · 恢复训练"}
        </span>
      </header>

      <ul className="trigger-reasons">
        {ep.reasons.map((r) => (
          <li key={r}>⚠️ {r}</li>
        ))}
      </ul>

      {observing && (
        <div className="loop-progress">
          <div className="step">
            <span className={`dot ${cooled ? "done" : ""}`} />
            降温处置
          </div>
          <div className="step">
            <span className={`dot ${streak >= 1 ? "done" : ""}`} />
            复测正常 {Math.min(streak, 2)}/2
          </div>
          <div className="step">
            <span className={`dot ${streak >= 2 && cooled ? "done" : ""}`} />
            自动解除
          </div>
          <small className="muted">计数锚点：{anchor}（更正原蹄温会重置）</small>
        </div>
      )}

      {observing && (
        <div className="loop-forms">
          <div className="loop-form">
            <h4>① 记录降温处置</h4>
            <input value={action} onChange={(e) => setAction(e.target.value)} />
            <input
              placeholder="处置备注（可选）"
              value={coolNote}
              onChange={(e) => setCoolNote(e.target.value)}
            />
            <button onClick={saveCooling} disabled={busy || !action.trim()}>
              保存降温
            </button>
          </div>
          <div className="loop-form">
            <h4>② 登记复测温度{!cooled && "（须先记录降温）"}</h4>
            <div className="recheck-grid">
              {HOOFS.map((h) => (
                <label key={h}>
                  <span>{HOOF_LABEL[h]}</span>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="—"
                    value={temps[h] ?? ""}
                    onChange={(e) => setTemps((t) => ({ ...t, [h]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <button onClick={saveRecheck} disabled={busy || !cooled}>
              提交复测
            </button>
          </div>
        </div>
      )}

      <ul className="timeline">
        {timeline.map((ev) => (
          <TimelineEntry key={ev.id} ev={ev} />
        ))}
      </ul>
    </article>
  );
}

export function ObservationPanel({ date, onResult }: Props) {
  const state = useRootState();
  // 默认展示当日观察，同时保留历史（如已解除 / 已失效）档案便于追溯
  const [showAll, setShowAll] = useState(false);
  const episodes = state.episodes
    .filter((ep) => showAll || ep.triggerDate === date)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>降温处置 → 连续两次复测正常 → 解除</p>
          <h2>蹄叶炎观察闭环</h2>
        </div>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          显示历史档案
        </label>
      </div>
      {episodes.length === 0 ? (
        <p className="muted">{showAll ? "暂无任何观察档案" : "当日无观察档案"}</p>
      ) : (
        <div className="episode-grid">
          {episodes.map((ep) => (
            <EpisodeCard
              key={ep.id}
              episodeId={ep.id}
              horseName={
                state.horses.find((h) => h.id === ep.horseId)?.id ?? ep.horseId
              }
              onResult={onResult}
            />
          ))}
        </div>
      )}
    </section>
  );
}
