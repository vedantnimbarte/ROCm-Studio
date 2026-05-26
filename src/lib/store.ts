import { create } from "zustand";
import type { GpuInfo, GpuMetrics, Overview } from "./api";

const HISTORY = 120; // ~2 minutes at 1 Hz

interface Store {
  overview: Overview | null;
  setOverview: (o: Overview) => void;
  gpu: GpuInfo | null;
  setGpu: (g: GpuInfo) => void;
  metrics: GpuMetrics | null;
  metricsHistory: GpuMetrics[]; // ring buffer
  pushMetrics: (m: GpuMetrics) => void;
}

export const useStore = create<Store>((set) => ({
  overview: null,
  setOverview: (overview) => set({ overview }),
  gpu: null,
  setGpu: (gpu) => set({ gpu }),
  metrics: null,
  metricsHistory: [],
  pushMetrics: (m) =>
    set((s) => {
      const h = [...s.metricsHistory, m];
      if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
      return { metrics: m, metricsHistory: h };
    }),
}));
