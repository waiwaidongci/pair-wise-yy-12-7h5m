import { useSyncExternalStore } from "react";
import { hoofStore, type HoofState } from "../storage/hoofStore";

/** 订阅存储层状态（列表 / 训练名单 / 观察状态均由同一份状态派生，刷新后一致） */
export function useHoofState(): HoofState {
  return useSyncExternalStore(hoofStore.subscribe, hoofStore.getState, hoofStore.getState);
}
