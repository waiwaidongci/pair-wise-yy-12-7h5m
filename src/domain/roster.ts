/**
 * 马匹档案（修蹄档案基础数据，静态名册）
 */

export interface HorseProfile {
  id: string;
  name: string;
  category: "运动马" | "休养马";
  gaitIssue: string;
  hoofAssessment: string;
  shoeType: string;
  nailPattern: string;
  lastShoeing: string;
  nextCheck: string;
  photoNote: string;
}

export const HORSES: HorseProfile[] = [
  {
    id: "HORSE-18",
    name: "追风",
    category: "运动马",
    gaitIssue: "右前蹄外侧磨耗",
    hoofAssessment: "蹄形尚可，外侧壁偏薄",
    shoeType: "铝蹄铁",
    nailPattern: "6 钉（外侧加宽）",
    lastShoeing: "2026-09-06",
    nextCheck: "2026-10-04",
    photoNote: "右前外侧磨耗特写已归档",
  },
  {
    id: "HORSE-27",
    name: "雷霆",
    category: "运动马",
    gaitIssue: "后蹄裂纹",
    hoofAssessment: "蹄壁干燥，需保湿",
    shoeType: "钢蹄铁 + 护蹄垫",
    nailPattern: "4 钉",
    lastShoeing: "2026-09-08",
    nextCheck: "2026-10-06",
    photoNote: "后蹄裂纹拍照归档",
  },
  {
    id: "HORSE-31",
    name: "流星",
    category: "运动马",
    gaitIssue: "步态轻微不稳",
    hoofAssessment: "蹄踵偏低",
    shoeType: "铝蹄铁",
    nailPattern: "6 钉",
    lastShoeing: "2026-09-10",
    nextCheck: "2026-10-08",
    photoNote: "已标记，需教练复核",
  },
  {
    id: "HORSE-42",
    name: "云朵",
    category: "休养马",
    gaitIssue: "无",
    hoofAssessment: "蹄形正常",
    shoeType: "未装蹄铁（休养）",
    nailPattern: "—",
    lastShoeing: "2026-08-22",
    nextCheck: "2026-10-20",
    photoNote: "每月例行拍照",
  },
  {
    id: "HORSE-55",
    name: "疾电",
    category: "运动马",
    gaitIssue: "左后蹄轻微内扣",
    hoofAssessment: "蹄叉健康",
    shoeType: "钢蹄铁",
    nailPattern: "6 钉",
    lastShoeing: "2026-09-12",
    nextCheck: "2026-10-10",
    photoNote: "左后蹄内扣对比照已归档",
  },
];

export function horseName(id: string): string {
  const h = HORSES.find((x) => x.id === id);
  return h ? `${h.id} · ${h.name}` : id;
}
