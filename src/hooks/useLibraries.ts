import { useState, useEffect, useCallback } from "react";
import * as api from "@/lib/tauri";
import type { LibraryEntry, ChunkPreset } from "@/types";

// Singleton active library state shared across hook instances via module-level
// variable + custom event — avoids a Context just for this one value.
let _libraries: LibraryEntry[] = [];
let _activeLibrary: LibraryEntry | null = null;
const CHANGE_EVENT = "useLibraries:change";

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useLibraries() {
  const [libraries, setLibraries] = useState<LibraryEntry[]>(_libraries);
  const [activeLibrary, setActiveLibrary] = useState<LibraryEntry | null>(_activeLibrary);

  // Re-render when the module-level state changes in any instance.
  useEffect(() => {
    const handler = () => {
      setLibraries([..._libraries]);
      setActiveLibrary(_activeLibrary);
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  // Load registry on first mount.
  useEffect(() => {
    if (_libraries.length > 0) return; // already loaded
    api.listLibraries().then((libs) => {
      _libraries = libs;
      notify();
    });
  }, []);

  const openLibrary = useCallback(async (lib: LibraryEntry) => {
    await api.openLibrary(lib.id);
    _activeLibrary = lib;
    notify();
  }, []);

  const createLibrary = useCallback(
    async (name: string, path: string, preset: ChunkPreset) => {
      const entry = await api.createLibrary(name, path, preset);
      _libraries = [..._libraries, entry];
      _activeLibrary = entry;
      await api.openLibrary(entry.id);
      notify();
    },
    [],
  );

  const deleteLibrary = useCallback(async (id: string) => {
    await api.deleteLibrary(id);
    _libraries = _libraries.filter((l) => l.id !== id);
    if (_activeLibrary?.id === id) _activeLibrary = null;
    notify();
  }, []);

  const openExistingLibrary = useCallback(
    async (name: string, path: string, preset: ChunkPreset) => {
      const entry = await api.openExistingLibrary(name, path, preset);
      _libraries = [..._libraries, entry];
      _activeLibrary = entry;
      await api.openLibrary(entry.id);
      notify();
    },
    [],
  );

  const setLibraryPreset = useCallback(async (id: string, preset: ChunkPreset) => {
    await api.setLibraryPreset(id, preset);
    // Patch in-place so dependents re-render without a round-trip.
    _libraries = _libraries.map((l) => l.id === id ? { ...l, chunkPreset: preset } : l);
    if (_activeLibrary?.id === id) _activeLibrary = { ..._activeLibrary, chunkPreset: preset };
    notify();
  }, []);

  const setLibraryModel = useCallback(async (id: string, modelId: string) => {
    await api.setLibraryModel(id, modelId);
    _libraries = _libraries.map((l) => l.id === id ? { ...l, modelId } : l);
    if (_activeLibrary?.id === id) _activeLibrary = { ..._activeLibrary, modelId };
    notify();
  }, []);

  const refreshLibraries = useCallback(async () => {
    const libs = await api.listLibraries();
    _libraries = libs;
    if (_activeLibrary) {
      const updated = libs.find((l) => l.id === _activeLibrary?.id);
      if (updated) _activeLibrary = updated;
    }
    notify();
  }, []);

  return { libraries, activeLibrary, openLibrary, createLibrary, deleteLibrary, openExistingLibrary, setLibraryPreset, setLibraryModel, refreshLibraries };
}
