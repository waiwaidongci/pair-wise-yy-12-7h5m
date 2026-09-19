// 当日训练名单：直接消费 domain 的 trainingRoster 纯函数结果。
// 进入“蹄叶炎观察”或蹄温未测齐的马匹不得列入当日训练。

import { trainingRoster } from "../domain/rules";
import type { HorseDayStatus } from "../domain/rules";
import { useRootState } from "../storage/store";

function RosterColumn({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: HorseDayStatus[];
  tone: "ok" | "danger" | "warn";
  empty: string;
}) {
  return (
    <div className={`roster-col roster-${tone}`}>
      <header>
        <h3>{title}</h3>
        <span className="count">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul>
          {items.map((s) => (
            <li key={s.horseId}>
              <b>{s.horseId}</b>
              {s.reasons.length > 0 && (
                <span className="muted">{s.reasons.join("；")}</span>
              )}
              {s.gate === "pending" && (
                <span className="muted">
                  {(["LF", "RF", "LH", "RH"] as const)
                    .filter((h) => s.temps[h] === undefined)
                    .map((h) => ({ LF: "左前", RF: "右前", LH: "左后", RH: "右后" })[h])
                    .join("、")}
                  未测
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TrainingRoster({ date }: { date: string }) {
  const state = useRootState();
  const roster = trainingRoster(
    state.horses,
    date,
    state.tempRecords,
    state.episodes,
    state.events
  );

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>{date} · 训练准入闭环</p>
          <h2>当日训练名单</h2>
        </div>
      </div>
      <div className="roster-grid">
        <RosterColumn
          title="✅ 准予训练"
          items={roster.cleared}
          tone="ok"
          empty="今日暂无四蹄测齐且正常的马"
        />
        <RosterColumn
          title="🚫 蹄叶炎观察 · 禁入训练"
          items={roster.blocked}
          tone="danger"
          empty="无观察马匹"
        />
        <RosterColumn
          title="⏳ 蹄温未测齐 · 待补测"
          items={roster.pending}
          tone="warn"
          empty="所有马匹均已测蹄温"
        />
      </div>
    </section>
  );
}
