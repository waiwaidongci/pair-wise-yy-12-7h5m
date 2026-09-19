import { useState } from "react";
import {
  activeEpisodeOf,
  effectiveTempsFor,
  todayStr,
} from "../domain/hoofDomain";
import { HORSES } from "../domain/roster";
import { useHoofState } from "./hooks";

type Filter = "全部" | "观察中" | "可训练" | "运动马" | "休养马";
const FILTERS: Filter[] = ["全部", "观察中", "可训练", "运动马", "休养马"];

/** 马匹列表：修蹄档案 + 当前观察/训练状态 */
export function HorseList() {
  const { records, episodes } = useHoofState();
  const [filter, setFilter] = useState<Filter>("全部");
  const today = todayStr();

  const visible = HORSES.filter((h) => {
    const observed = activeEpisodeOf(episodes, h.id) !== undefined;
    if (filter === "观察中") return observed;
    if (filter === "可训练") return !observed;
    if (filter === "全部") return true;
    return h.category === filter;
  });

  return (
    <aside className="panel">
      <h2>马匹列表</h2>
      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={filter === f ? "chip-active" : ""}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="horse-list">
        {visible.map((h) => {
          const episode = activeEpisodeOf(episodes, h.id);
          const measured = Object.keys(effectiveTempsFor(records, h.id, today)).length > 0;
          return (
            <article key={h.id} className="horse-card">
              <div className="horse-head">
                <strong>
                  {h.id} · {h.name}
                </strong>
                {episode ? (
                  <span className="badge badge-ban">观察中</span>
                ) : (
                  <span className="badge badge-ok">可训练</span>
                )}
              </div>
              <p>
                {h.category} · {h.shoeType} · 钉位 {h.nailPattern}
              </p>
              <p>
                步态：{h.gaitIssue} · 蹄形：{h.hoofAssessment}
              </p>
              <p>
                下次复查 {h.nextCheck} · {h.photoNote}
              </p>
              {!episode && !measured && <p className="hint">今日尚未测温</p>}
              {episode && <p className="hint hint-warn">触发：{episode.trigger.detail}</p>}
            </article>
          );
        })}
        {visible.length === 0 && <p className="hint">该分类下暂无马匹。</p>}
      </div>
    </aside>
  );
}
