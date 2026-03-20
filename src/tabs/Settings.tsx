import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
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

export default function Settings() {
  const [apiKey,    setApiKey]    = useState("");
  const [model,     setModel]     = useState(DEFAULT_MODEL);
  const [showKey,   setShowKey]   = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.getApiKey().then(k => { if (k) setApiKey(k); });
    api.getModelPreference().then(m => { if (m) setModel(m); });
  }, []);

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

  return (
    <div className="p-5 flex flex-col gap-6 max-w-lg">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">Settings</h2>
        <p className="text-xs text-zinc-500 mt-0.5">API key and model are stored in your OS keychain.</p>
      </div>

      {/* API key */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-zinc-400">OpenRouter API key</label>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 bg-transparent focus-within:border-indigo-500/50 transition-colors">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-or-…"
            className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600 font-mono"
          />
          <button
            onClick={() => setShowKey(v => !v)}
            className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
            tabIndex={-1}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-xs text-zinc-700">
          Get a free key at{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
            className="text-indigo-500 hover:text-indigo-400 underline">
            openrouter.ai/keys
          </a>
        </p>
      </div>

      {/* Model selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-zinc-400">Chat model</label>
        <div className="relative">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="appearance-none w-full px-3 py-2 pr-8 rounded-lg border border-zinc-700 bg-[#0f0f1a] text-sm text-zinc-200 outline-none focus:border-indigo-500/50 transition-colors cursor-pointer"
          >
            {Object.entries(MODELS).map(([group, options]) => (
              <optgroup key={group} label={group} className="bg-[#0f0f1a] text-zinc-400">
                {options.map(o => (
                  <option key={o.value} value={o.value} className="bg-[#0f0f1a] text-zinc-200">{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* Custom dropdown chevron */}
          <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
            width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-md transition-colors"
        >
          Save
        </button>
        {saved && (
          <span className="text-sm text-emerald-400">Saved ✓</span>
        )}
        {saveError && (
          <span className="text-xs text-rose-400">{saveError}</span>
        )}
      </div>
    </div>
  );
}
