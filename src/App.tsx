import { useMemo, useState } from "react";
import "./styles.css";
import {
  HOOFS,
  isActiveDailyRecord,
  isUnderObservation,
  trainingRoster,
} from "./domain/rules";
import { repo } from "./storage/repository";
import { useRootState } from "./storage/store";
import { TemperatureEntry } from "./components/TemperatureEntry";
import { HorseList } from "./components/HorseList";
import { TrainingRoster } from "./components/TrainingRoster";
import { ObservationPanel } from "./components/ObservationPanel";
import { HistoryArchive } from "./components/HistoryArchive";
import { todayStr } from "./lib/time";

interface Toast {
  id: number;
  msg: string;
  kind: "ok" | "warn" | "err";
}

function App() {
  const state = useRootState();
  const [date, setDate] = useState(todayStr());
  const [toasts, setToasts] = useState<Toast[]>([]);

  const roster = useMemo(
    () =>
      trainingRoster(
        state.horses,
        date,
        state.tempRecords,
        state.episodes,
        state.events
      ),
    [state, date]
  );

  const observingCount = state.episodes.filter((ep) =>
    isUnderObservation(ep, state.events)
  ).length;
  const activeTempCount = state.tempRecords.filter(isActiveDailyRecord).length;
  const archivedCount = state.tempRecords.filter((r) => r.supersededAt).length;
  const revokedReleases = state.events.filter(
    (e) => e.kind === "release" && !e.active
  ).length;

  function pushToast(msg: string, kind: Toast["kind"]) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62011 · 蹄温预警与训练禁入闭环</p>
        <h1>修蹄档案 · 蹄叶炎预警台</h1>
        <span>
          每匹马每个蹄位每天只保留一条有效蹄温；单蹄 &gt; 38.5℃ 或左右前蹄温差 &gt;
          1.5℃ 即进入蹄叶炎观察、不得列入当日训练；观察须记录降温处置，连续两次复测正常才解除；
          原蹄温更正后旧解除立即失效、历史留档；重复或并发提交沿用首次结果。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>当日准予训练</small>
          <strong>{roster.cleared.length}</strong>
        </article>
        <article>
          <small>观察中 · 禁入训练</small>
          <strong className="metric-danger">{observingCount}</strong>
        </article>
        <article>
          <small>待补测蹄温</small>
          <strong className="metric-warn">{roster.pending.length}</strong>
        </article>
        <article>
          <small>有效 / 归档蹄温</small>
          <strong>
            {activeTempCount}
            <em> / {archivedCount}</em>
          </strong>
        </article>
      </section>

      <div className="rule-strip">
        <span>阈值：单蹄 &gt; 38.5℃</span>
        <span>左右前蹄温差 &gt; 1.5℃</span>
        <span>解除：降温处置 + 连续两次复测正常</span>
        <span>更正原蹄温 ⇒ 旧解除立即失效（{revokedReleases} 条已失效留档）</span>
        <span>蹄位：{HOOFS.length} 个</span>
        <button
          className="ghost"
          onClick={() => {
            repo.resetDemoData();
            setDate(todayStr());
            pushToast("已恢复演示数据", "ok");
          }}
        >
          重置演示数据
        </button>
      </div>

      <TrainingRoster date={date} />

      <section className="workspace">
        <TemperatureEntry date={date} onDateChange={setDate} onResult={pushToast} />
      </section>

      <HorseList date={date} />

      <ObservationPanel date={date} onResult={pushToast} />

      <HistoryArchive />

      <footer className="footnote muted">
        业务判断（domain/rules）、记录存储（storage）、页面展示（components）三层分离；
        数据持久化于 localStorage，刷新页面后列表、训练名单与观察状态保持一致。
      </footer>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
