import { create } from "zustand";
import { persist } from "zustand/middleware";

type CrewState = {
  selectedWorkstreamId: string | null;
  sidebarCollapsed: boolean;
  setSelectedWorkstreamId: (workstreamId: string | null) => void;
  toggleSidebar: () => void;
};

export const useCrewStore = create<CrewState>()(
  persist(
    (set) => ({
      selectedWorkstreamId: null,
      sidebarCollapsed: false,
      setSelectedWorkstreamId: (selectedWorkstreamId) =>
        set({ selectedWorkstreamId }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
    }),
    {
      name: "crew-ui"
    }
  )
);
