// 时间工具：统一使用当地日期 YYYY-MM-DD，事件时间用 ISO 字符串。

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayStr(): string {
  return dateStr(new Date());
}

/** 相对今天偏移 offset 天的日期 */
export function dayOffset(offset: number, base: Date = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + offset);
  return dateStr(d);
}

/** 偏移日 offset 天、指定时分的本地 ISO 时间戳 */
export function isoAt(offset: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function isoNow(): string {
  return new Date().toISOString();
}
