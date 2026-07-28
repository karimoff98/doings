import { create } from 'zustand';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveStatusState {
  status: SaveStatus;
  /** Time of the last successful save, for the tooltip. */
  savedAt?: number;
  set: (status: SaveStatus) => void;
}

/**
 * Deliberately a separate store without persistence: writing the save status
 * into the persisted store would trigger another save, which would update the
 * status again — an endless loop.
 */
export const useSaveStatus = create<SaveStatusState>()((set) => ({
  status: 'idle',
  set: (status) => set(status === 'saved' ? { status, savedAt: Date.now() } : { status }),
}));

export function reportSaveStatus(status: SaveStatus): void {
  useSaveStatus.getState().set(status);
}
