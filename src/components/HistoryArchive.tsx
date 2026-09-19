// 历史留档：不删除任何记录。重复归档、被更正的旧蹄温、失效解除、审计事件全部可查。

import { useMemo, useState } from "react";
import { HOOF_LABEL, isActiveDailyRecord } from "../domain/rules";
import type { TempRecord } from "../domain/types";
import { useRootState } from "../storage/store";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function RecordRow({ r, horseName }: { r: TempRecord; horseName: string }) {
  return (
    <tr className={r.supersededAt ? "row-superseded" : ""}>
      <td>{r.date}</td>
      <td>{horseName}</td>
      <td>{HOOF_LABEL[r.hoof]}</td>
      <td>{r.temperature.toFixed(1)}℃</td>
      <td>
        {r.source === "initial" ? "初测" : r.source === "correction" ? "更正" : "复测"}
      </td>
      <td>
        {!r.supersededAt ? (
          <span className="tag tag-ok">有效</span>
        ) : (
          <span className="tag tag-muted">
            {r.supersededReason === "duplicate" ? "重复归档" : "被更正留档"}
          </span>
        )}
      </td>
      <td className="muted">{timeLabel(r.createdAt)}</td>
      <td className="muted">{r.note ?? ""}</td>
    </tr>
  );
}

export function HistoryArchive() {
  const state = useRootState();
  const [mode, setMode] = useState<"all" | "archived" | "releases">("all");

  const nameOf = (id: string) =>
    state.horses.find((h) => h.id === id)?.id ?? id;

  const records = useMemo(() => {
    const list = [...state.tempRecords].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    if (mode === "archived") return list.filter((r) => r.supersededAt);
    return list;
  }, [state.tempRecords, mode]);

  const releases = useMemo(
    () =>
      state.events
        .filter((e) => e.kind === "release" || e.kind === "revocation")
        .sort((a, b) => b.at.localeCompare(a.at)),
    [state.events]
  );

  const activeCount = state.tempRecords.filter(isActiveDailyRecord).length;
  const archivedCount = state.tempRecords.filter((r) => r.supersededAt).length;

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>只追加、不删除 · 刷新后一致</p>
          <h2>蹄温与解除历史留档</h2>
        </div>
        <div className="seg">
          <button
            className={mode === "all" ? "primary" : ""}
            onClick={() => setMode("all")}
          >
            全部蹄温（{state.tempRecords.length}）
          </button>
          <button
            className={mode === "archived" ? "primary" : ""}
            onClick={() => setMode("archived")}
          >
            仅归档（{archivedCount}）
          </button>
          <button
            className={mode === "releases" ? "primary" : ""}
            onClick={() => setMode("releases")}
          >
            解除/失效记录（{releases.length}）
          </button>
        </div>
      </div>

      <p className="muted">
        当前有效蹄温 {activeCount} 条；归档（重复 / 被更正）{archivedCount} 条。每匹马每个蹄位每天仅一条有效记录。
      </p>

      {mode !== "releases" ? (
        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>马匹</th>
                <th>蹄位</th>
                <th>温度</th>
                <th>来源</th>
                <th>状态</th>
                <th>时间</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <RecordRow key={r.id} r={r} horseName={nameOf(r.horseId)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="release-log">
          {releases.map((ev) => {
            const ep = state.episodes.find((e) => e.id === ev.episodeId);
            const horse = ep ? nameOf(ep.horseId) : "?";
            if (ev.kind === "release") {
              return (
                <li key={ev.id} className={ev.active ? "" : "row-superseded"}>
                  <span className={`tag ${ev.active ? "tag-ok" : "tag-muted"}`}>
                    {ev.active ? "有效解除" : "已失效解除"}
                  </span>
                  <b>
                    {horse} · {ep?.triggerDate}
                  </b>
                  <span className="muted">{timeLabel(ev.at)}</span>
                  {!ev.active && ev.revokeReason && (
                    <span className="muted">{ev.revokeReason}</span>
                  )}
                </li>
              );
            }
            return (
              <li key={ev.id} className="row-superseded">
                <span className="tag tag-danger">解除失效</span>
                <b>
                  {horse} · {ep?.triggerDate}
                </b>
                <span className="muted">{timeLabel(ev.at)}</span>
                <span className="muted">
                  原蹄温更正（{ev.correctedRecordId.slice(-6)}），须重新降温 + 两次复测
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
