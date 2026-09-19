// 马匹列表：与训练名单共用 horseDayStatus 派生结果，保证两处状态一致。

import {
  HOOFS,
  horseDayStatus,
} from "../domain/rules";
import { useRootState } from "../storage/store";
import { FrontDiffBadge, GateBadge, HoofTempCell } from "./ui";

export function HorseList({ date }: { date: string }) {
  const state = useRootState();

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>{date} · 马匹蹄温一览</p>
          <h2>马匹列表</h2>
        </div>
      </div>
      <div className="horse-list">
        {state.horses.map((h) => {
          const s = horseDayStatus(
            h.id,
            date,
            state.tempRecords,
            state.episodes,
            state.events
          );
          return (
            <article key={h.id} className={`horse-row gate-${s.gate}`}>
              <div className="horse-id">
                <h3>
                  {h.id} <span className="muted">{h.name}</span>
                </h3>
                <small>
                  {h.stable} · {h.category}
                </small>
                <div className="badge-line">
                  <GateBadge gate={s.gate} />
                  <FrontDiffBadge temps={s.temps} />
                </div>
              </div>
              <div className="hoof-grid">
                {HOOFS.map((hf) => (
                  <HoofTempCell key={hf} hoof={hf} value={s.temps[hf]} />
                ))}
              </div>
              {(s.reasons.length > 0 || s.episode) && (
                <ul className="reason-list">
                  {s.episode && (
                    <li>观察档案 {s.episode.id.slice(-8)}：{s.episode.reasons.join("；") || "复测闭环管理中"}</li>
                  )}
                  {s.reasons
                    .filter((x) => !s.episode?.reasons.includes(x))
                    .map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
