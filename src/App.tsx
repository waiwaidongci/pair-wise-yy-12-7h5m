import "./styles.css";
import {
  activeEpisodeOf,
  todayStr,
  SINGLE_HOOF_LIMIT_C,
  FRONT_DIFF_LIMIT_C,
} from "./domain/hoofDomain";
import { HORSES } from "./domain/roster";
import { useHoofState } from "./ui/hooks";
import { HorseList } from "./ui/HorseList";
import { TemperatureForm } from "./ui/TemperatureForm";
import { DailyBoard } from "./ui/DailyBoard";
import { ObservationPanel } from "./ui/ObservationPanel";
import { TrainingRoster } from "./ui/TrainingRoster";
import { RecordHistory } from "./ui/RecordHistory";

/**
 * 页面展示层：仅负责渲染与交互，
 * 业务判断见 src/domain/hoofDomain.ts，记录存储见 src/storage/hoofStore.ts。
 */
function App() {
  const { records, episodes } = useHoofState();
  const today = todayStr();

  const todayRecords = records.filter((r) => r.effective && r.date === today).length;
  const observing = HORSES.filter((h) => activeEpisodeOf(episodes, h.id)).length;
  const trainable = HORSES.length - observing;

  const metrics: Array<[string, number]> = [
    ["马匹档案", HORSES.length],
    ["今日有效蹄温", todayRecords],
    ["蹄叶炎观察中", observing],
    ["今日可训练", trainable],
  ];

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62011 · 蹄温预警与训练禁入闭环</p>
        <h1>马术蹄温预警与训练禁入</h1>
        <span>
          每匹马每个蹄位每天只保留一条有效蹄温，重复录入自动更正留档；左右前蹄温差超过{" "}
          {FRONT_DIFF_LIMIT_C}℃ 或单蹄超过 {SINGLE_HOOF_LIMIT_C}℃
          即进入蹄叶炎观察并禁止当日训练。观察期须记录降温处置，连续两次复测正常方可解除；
          原蹄温一旦更正，旧解除立即失效并留档。
        </span>
      </section>

      <section className="metrics">
        {metrics.map(([label, value]) => (
          <article key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <HorseList />
        <TemperatureForm />
      </section>

      <DailyBoard />
      <ObservationPanel />
      <TrainingRoster />
      <RecordHistory />
    </main>
  );
}

export default App;
