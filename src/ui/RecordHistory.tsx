import { HOOF_LABELS, formatTime } from "../domain/hoofDomain";
import { horseName } from "../domain/roster";
import { hoofStore } from "../storage/hoofStore";
import { useHoofState } from "./hooks";

/** 蹄温记录留档：有效记录与被更正记录全量可查 */
export function RecordHistory() {
  const { records } = useHoofState();
  const sorted = [...records].sort((a, b) => b.recordedAt - a.recordedAt);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>历史留档</p>
          <h2>蹄温记录（含更正）</h2>
        </div>
        <button
          className="ghost"
          onClick={() => {
            if (window.confirm("将清空全部蹄温与观察数据并恢复演示数据，确定？")) {
              hoofStore.resetToSeed();
            }
          }}
        >
          重置演示数据
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>录入时间</th>
              <th>马匹</th>
              <th>蹄位</th>
              <th>测量日期</th>
              <th>蹄温</th>
              <th>状态</th>
              <th>提交凭证</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className={r.effective ? "" : "row-superseded"}>
                <td>{formatTime(r.recordedAt)}</td>
                <td>{horseName(r.horseId)}</td>
                <td>{HOOF_LABELS[r.hoof]}</td>
                <td>{r.date}</td>
                <td>{r.temperature.toFixed(1)}℃</td>
                <td>
                  {r.effective ? (
                    <span className="badge badge-ok">有效</span>
                  ) : (
                    <span className="badge badge-muted">已被更正</span>
                  )}
                </td>
                <td className="mono">{r.submissionKey.slice(0, 13)}…</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="hint">
                  暂无蹄温记录。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
