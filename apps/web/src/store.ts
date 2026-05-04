import { create } from "zustand";

type CrewState = {
  workstreamId: string | null;
  setWorkstreamId: (workstreamId: string) => void;
};

export const useCrewStore = create<CrewState>((set) => ({
  workstreamId: null,
  setWorkstreamId: (workstreamId) => set({ workstreamId })
}));
