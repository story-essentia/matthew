import { useState, useEffect } from "react";
import {
  Eye,
  EyeOff,
  Key,
  FolderOpen,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  Cpu,
  Download,
  AlertTriangle,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import * as api from "@/lib/tauri";

const MODELS = {
  "Free — auto-selected": [
    { value: "openrouter/free",                        label: "Auto-select best free (recommended)" },
  ],
  "Free — specific models": [
    { value: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)"  },
    { value: "deepseek/deepseek-r1:free",              label: "DeepSeek R1 (free)"     },
    { value: "google/gemma-3-27b-it:free",             label: "Gemma 3 27B (free)"     },
  ],
  "Affordable": [
    { value: "openai/gpt-4o-mini",         label: "GPT-4o Mini"      },
    { value: "anthropic/claude-3-5-haiku", label: "Claude 3.5 Haiku" },
    { value: "google/gemini-2.0-flash",    label: "Gemini 2.0 Flash" },
  ],
  "SOTA": [
    { value: "anthropic/claude-sonnet-4-6",     label: "Claude Sonnet 4.6" },
    { value: "openai/gpt-4o",                   label: "GPT-4o"            },
    { value: "google/gemini-2.5-pro-exp-03-25", label: "Gemini 2.5 Pro"    },
  ],
} as const;

const DEFAULT_MODEL = "openrouter/free";

// Update status machine
type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "latest" }
  | { state: "available"; version: string }
  | { state: "downloading"; progress: number }
  | { state: "ready" }
  | { state: "failed"; error: string };

export default function Settings() {
  const [apiKey,    setApiKey]    = useState("");
  const [model,     setModel]     = useState(DEFAULT_MODEL);
  const [showKey,   setShowKey]   = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [modelStoragePath, setModelStoragePath] = useState<string | null>(null);

  const [update, setUpdate] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    api.getApiKey().then(k => { if (k) setApiKey(k); });
    api.getModelPreference().then(m => { if (m) setModel(m); });
    api.getModelStoragePath().then(setModelStoragePath);
  }, []);

  const handleChangeLocation = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setSaving(true);
      setSaveError(null);
      try {
        await api.saveModelStoragePath(selected as string);
        setModelStoragePath(selected as string);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err: unknown) {
        const msg = (err as { message?: string })?.message ?? String(err);
        setSaveError(msg);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        api.saveApiKey(apiKey),
        api.saveModelPreference(model),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? String(err);
      console.error("[Settings] save failed:", err);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleCheckUpdates = async () => {
    setUpdate({ state: "checking" });
    try {
      const result = await api.checkForUpdates();
      if (result) {
        setUpdate({ state: "available", version: result.version });
      } else {
        setUpdate({ state: "latest" });
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? String(err);
      console.error("[Settings] update check failed:", err);
      setUpdate({ state: "failed", error: msg });
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      const result = await api.checkForUpdates();
      if (!result) return;
      setUpdate({ state: "downloading", progress: 0 });
      await result.downloadAndInstall((event) => {
        if ("event" in event && event.event === "Progress") {
          // The progress event contains contentLength and chunkLength
          setUpdate(prev =>
            prev.state === "downloading"
              ? { state: "downloading", progress: Math.min(99, prev.progress + 1) }
              : prev
          );
        }
      });
      setUpdate({ state: "ready" });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? String(err);
      setUpdate({ state: "failed", error: msg });
    }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl h-full overflow-y-auto custom-scrollbar">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Configure your local RAG parameters, API tokens, and application
          updates.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {/* ── Card 1: API Configuration ────────────────────────────────── */}
        <section className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/10 backdrop-blur-md flex flex-col gap-4">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/60">
            <Key size={15} className="text-indigo-400" />
            <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              API Configuration
            </h3>
          </div>

          {/* API key */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-medium text-zinc-400">
                OpenRouter API key
              </label>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
              >
                Get key <ExternalLink size={10} />
              </a>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-950/40 focus-within:border-indigo-500/40 transition-colors">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-or-…"
                className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-700 font-mono"
              />
              <button
                onClick={() => setShowKey(v => !v)}
                className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
                tabIndex={-1}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Model selector */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-zinc-400">
              Chat Model
            </label>
            <div className="relative">
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="appearance-none w-full px-3 py-2 pr-8 rounded-lg border border-zinc-800 bg-zinc-950/40 text-sm text-zinc-200 outline-none focus:border-indigo-500/40 transition-colors cursor-pointer"
              >
                {Object.entries(MODELS).map(([group, options]) => (
                  <optgroup
                    key={group}
                    label={group}
                    className="bg-[#0f0f1a] text-zinc-400"
                  >
                    {options.map(o => (
                      <option
                        key={o.value}
                        value={o.value}
                        className="bg-[#0f0f1a] text-zinc-200"
                      >
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
              >
                <path
                  d="M2 4l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </section>

        {/* ── Card 2: Model Storage ────────────────────────────────────── */}
        <section className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/10 backdrop-blur-md flex flex-col gap-4">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/60">
            <FolderOpen size={15} className="text-indigo-400" />
            <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Model Storage
            </h3>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-zinc-400">
              Embedding Model Storage Location
            </label>
            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-950/40">
              <span className="text-xs text-zinc-300 truncate font-mono">
                {modelStoragePath ?? "Default Application Cache"}
              </span>
              <button
                onClick={handleChangeLocation}
                disabled={saving}
                className="shrink-0 px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors disabled:opacity-50"
              >
                Change Location
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">
              Fastembed embedding models will be downloaded and stored at this
              path.
            </p>
          </div>
        </section>

        {/* ── Card 3: Application Updates ──────────────────────────────── */}
        <section className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/10 backdrop-blur-md flex flex-col gap-4">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/60">
            <Cpu size={15} className="text-indigo-400" />
            <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Application Updates
            </h3>
          </div>

          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Current Version</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-200 font-mono">
                  v0.1.0
                </span>
                <span className="text-[10px] text-emerald-400 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                  Stable
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {update.state === "checking" && (
                <span className="text-xs text-zinc-400 flex items-center gap-1.5 animate-pulse">
                  <RefreshCw size={12} className="animate-spin" /> Checking…
                </span>
              )}
              {update.state === "latest" && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Up to date
                </span>
              )}
              {update.state === "available" && (
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <Download size={12} /> v{update.version} available
                </span>
              )}
              {update.state === "downloading" && (
                <span className="text-xs text-indigo-400 flex items-center gap-1.5 animate-pulse">
                  <RefreshCw size={12} className="animate-spin" /> Downloading…
                </span>
              )}
              {update.state === "ready" && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Restart to apply
                </span>
              )}
              {update.state === "failed" && (
                <span className="text-xs text-rose-400 flex items-center gap-1 max-w-[200px] truncate" title={update.error}>
                  <AlertTriangle size={12} /> {update.error}
                </span>
              )}

              {update.state === "available" ? (
                <button
                  onClick={handleDownloadUpdate}
                  className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                >
                  Download & Install
                </button>
              ) : (
                <button
                  onClick={handleCheckUpdates}
                  disabled={update.state === "checking" || update.state === "downloading"}
                  className="px-3 py-1.5 text-xs font-medium border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/30 text-zinc-200 rounded-lg transition-all disabled:opacity-40"
                >
                  Check for Updates
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ── Save action row ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors shadow-md shadow-indigo-600/10"
          >
            Save Changes
          </button>
          {saved && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Saved successfully
            </span>
          )}
          {saveError && (
            <span className="text-xs text-rose-400">{saveError}</span>
          )}
        </div>
      </div>
    </div>
  );
}
