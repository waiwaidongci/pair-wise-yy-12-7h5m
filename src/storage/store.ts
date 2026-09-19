// React 与存储层之间的唯一桥梁：所有组件订阅同一个仓储单例，
// 因此列表、训练名单、观察面板与刷新后的状态始终来自同一份数据。

import { useSyncExternalStore } from "react";
import { repo } from "./repository";
import type { RootState } from "../domain/types";

export function useRootState(): RootState {
  return useSyncExternalStore(
    (cb) => repo.subscribe(cb),
    () => repo.getState()
  );
}

export function newToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
