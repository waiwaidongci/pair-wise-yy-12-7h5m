import {
  activeEpisodeOf,
  effectiveTempsFor,
  todayStr,
} from "../domain/hoofDomain";
import { HORSES } from "../domain/roster";
import { useHoofState } from "./hooks";

/** 当日训练名单：观察中的马匹一律禁入，与列表、存储状态同源 */
export function TrainingRoster() {
  const { records, episodes } = useHoofState();
  const today = todayStr();

  const allowed = HORSES.filter((h) => !activeEpisodeOf(episodes, h.id));
  const banned = HORSES.filter((h) => activeEpisodeOf(episodes, h.id));

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>{today}</p>
          <h2>当日训练名单</h2>
        </div>
        <span className="badge badge-ok">{allowed.length} 匹可训练</span>
      </div>

      <div className="roster-cols">
        <div>
          <h3 className="subheading">允许入训</h3>
          <ul className="roster">
            {allowed.map((h) => {
              const measured = Object.keys(effectiveTempsFor(records, h.id, today)).length > 0;
              return (
                <li key={h.id}>
                  <strong>
                    {h.id} · {h.name}
                  </strong>
                  <span className={`badge ${measured ? "badge-ok" : "badge-muted"}`}>
                    {measured ? "今日已测温" : "今日未测温"}
                  </span>
                </li>
              );
            })}
            {allowed.length === 0 && <li className="hint">今日无可训练马匹。</li>}
          </ul>
        </div>

        <div>
          <h3 className="subheading">禁止入训（蹄叶炎观察）</h3>
          <ul className="roster">
            {banned.map((h) => {
              const ep = activeEpisodeOf(episodes, h.id)!;
              return (
                <li key={h.id} className="roster-ban">
                  <strong>
                    {h.id} · {h.name}
                  </strong>
                  <span className="badge badge-ban">禁入</span>
                  <small>{ep.trigger.detail}</small>
                </li>
              );
            })}
            {banned.length === 0 && <li className="hint">今日无禁训马匹。</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
