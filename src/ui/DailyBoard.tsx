import { useState } from "react";
import {
  evaluateDayTemps,
  effectiveTempsFor,
  activeEpisodeOf,
  HOOF_ORDER,
  SINGLE_HOOF_LIMIT_C,
  FRONT_DIFF_LIMIT_C,
  todayStr,
} from "../domain/hoofDomain";
import { HORSES } from "../domain/roster";
import { useHoofState } from "./hooks";

/** 当日蹄温总览：每匹马四个蹄位的有效蹄温、温差、预警与训练状态 */
export function DailyBoard() {
  const { records, episodes } = useHoofState();
  const [date, setDate] = useState(todayStr());

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>每日晨检</p>
          <h2>当日蹄温总览</h2>
        </div>
        <label className="date-picker">
          <span>查看日期</span>
          <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>马匹</th>
              <th>左前</th>
              <th>右前</th>
              <th>左后</th>
              <th>右后</th>
              <th>前蹄温差</th>
              <th>预警判定</th>
              <th>当日训练</th>
            </tr>
          </thead>
          <tbody>
            {HORSES.map((horse) => {
              const temps = effectiveTempsFor(records, horse.id, date);
              const trigger = evaluateDayTemps(temps);
              const episode = activeEpisodeOf(episodes, horse.id);
              const measured = HOOF_ORDER.some((p) => temps[p] !== undefined);
              const diff =
                temps.LF !== undefined && temps.RF !== undefined
                  ? Math.abs(temps.LF - temps.RF)
                  : null;
              return (
                <tr key={horse.id}>
                  <td>
                    <strong>{horse.id}</strong> {horse.name}
                  </td>
                  {HOOF_ORDER.map((p) => {
                    const v = temps[p];
                    const hot = v !== undefined && v > SINGLE_HOOF_LIMIT_C;
                    return (
                      <td key={p} className={hot ? "cell-hot" : ""}>
                        {v !== undefined ? `${v.toFixed(1)}℃` : "—"}
                      </td>
                    );
                  })}
                  <td className={diff !== null && diff > FRONT_DIFF_LIMIT_C ? "cell-hot" : ""}>
                    {diff !== null ? `${diff.toFixed(1)}℃` : "—"}
                  </td>
                  <td>
                    {!measured ? (
                      <span className="badge badge-muted">未测温</span>
                    ) : trigger ? (
                      <span className="badge badge-warn">{trigger.detail}</span>
                    ) : (
                      <span className="badge badge-ok">正常</span>
                    )}
                  </td>
                  <td>
                    {episode ? (
                      <span className="badge badge-ban">禁止 · 观察中</span>
                    ) : (
                      <span className="badge badge-ok">可训练</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
