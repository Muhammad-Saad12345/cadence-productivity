"use client";
import { createContext, useContext } from "react";
import type { TaskInput } from "@/lib/queries";

export interface UIContextValue {
  openQuickAdd: (defaults?: TaskInput) => void;
  openTask: (id: string | null, defaults?: TaskInput) => void;
  openSearch: () => void;
}
export const UIContext = createContext<UIContextValue>({
  openQuickAdd: () => {},
  openTask: () => {},
  openSearch: () => {},
});
export const useUI = () => useContext(UIContext);
