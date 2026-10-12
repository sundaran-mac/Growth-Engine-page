import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

/** localStorage that never throws (private mode, blocked storage, SSR). */
export const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      /* storage blocked: keep state in memory only */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

interface UiState {
  /** Product chosen in the sidebar switcher. Persisted. */
  selectedProductId: string | null;
  /** Sidebar drawer open (screens narrower than 1024px). */
  sidebarOpen: boolean;
  /** Command palette (Cmd+K) open. */
  commandOpen: boolean;
  setSelectedProductId: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
}

export const UI_STORAGE_KEY = 'growth-desk:ui';

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      selectedProductId: null,
      sidebarOpen: false,
      commandOpen: false,
      setSelectedProductId: (id) => set({ selectedProductId: id }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setCommandOpen: (open) => set({ commandOpen: open }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
    }),
    {
      name: UI_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ selectedProductId: s.selectedProductId }),
    },
  ),
);
