---
name: frontend-ui
description: Covers all React/TypeScript frontend code for Matthew. Use when building or editing tab layout (Libraries / Import / Explore / Settings), shadcn/ui components, Tailwind styling, Tauri invoke wrappers, React hooks, file drop zone, chunk size preset selector, retrieval control, ingestion progress, first-run screen, OpenRouter chat interface, chat history drawer, or Settings tab. Do not use for Rust backend code.
---

# Frontend UI — React 18 + TypeScript + Tailwind

## Design Language

Dark purple theme. Modern, calm, professional.

| Token | Value |
|---|---|
| App background | `#0f0f1a` (set in index.css on html/body) |
| Sidebar background | `#0c0c16` |
| Surface | `bg-white/5` |
| Border subtle | `border-white/5` |
| Border default | `border-white/10` |
| Accent | `violet-500` / `violet-400` |
| Active nav item | `bg-violet-500/15 text-violet-400` |
| Text primary | `text-white/90` |
| Text secondary | `text-white/50` |
| Text muted | `text-white/30` |
| Success | `emerald-400` |
| Warning | `amber-500` |
| Error | `rose-500` |
| User chat bubble | `bg-violet-600 text-white rounded-2xl rounded-br-sm` |
| Assistant bubble | `bg-white/5 text-white/75 rounded-2xl rounded-bl-sm text-base leading-7` |
| Font | DM Sans (locally bundled in src/assets/fonts/, declared in index.css) |

## Font Setup

DM Sans is bundled locally — NOT loaded from Google Fonts (offline requirement).

```css
/* src/index.css */
@font-face {
  font-family: 'DM Sans';
  src: url('/assets/fonts/DMSans-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
/* medium and italic variants also declared */
```

```js
// tailwind.config.js
theme: { extend: { fontFamily: { sans: ['DM Sans', 'system-ui', 'sans-serif'] } } }
```

## Shell — Owns Tab Persistence

The Shell ensures that both **Explore** and **Import** tabs persist their state across switches. Both are kept mounted using the `hidden` class — never unmount them.

```tsx
<div className={active === "import" ? "h-full flex flex-col" : "hidden h-full flex flex-col"}>
  <Import activeLibrary={activeLibrary} />
</div>
<div className={active === "explore" ? "h-full" : "hidden"}>
  <Explore ... />
</div>
```

### Reset State on Library Change (Synchronous)

While tabs persist during normal switching, their state must be **reset** when the user switches to a different library. This is handled at two levels:

1. **Shell-level Synchronous Reset**: In `Shell.tsx`, the Explore state variables are cleared synchronously during the render phase when the `activeLibrary.path` changes. This prevents stale state from one library being "auto-saved" into another library during the transition.
2. **Component Remounting via `key`**: In `Shell.tsx`, the `<Explore>` component is given a `key={activeLibrary?.path ?? 'empty'}`. This forces React to completely unmount and remount the component when the library changes, effectively resetting all internal `useRef` hooks (like `chatIdRef`) and local state.

```tsx
// Shell.tsx
<Explore
  key={activeLibrary?.path ?? "empty"}
  libraryPath={activeLibrary?.path ?? null}
  // ... state props ...
/>
```

## Explore Tab — Single Toolbar Line

The Explore tab has ONE toolbar line at the top using CSS grid for true centering:

```tsx
<div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-2 border-b border-white/5 shrink-0">
  {/* LEFT: History + RetrievalControl */}
  <div className="flex items-center gap-2">
    {libraryPath && (
      <button onClick={openHistory} className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/70 px-2 py-1.5 rounded-md hover:bg-white/5">
        <Clock size={13} /><span>History</span>
      </button>
    )}
    <RetrievalControl topK={topK} onChange={setTopK} mode={mode} />
  </div>
  {/* CENTER: Search/Chat toggle */}
  <div className="flex justify-center">
    <div className="flex bg-white/5 rounded-lg p-1 gap-0.5">
      <button onClick={() => setMode('search')} className={`w-24 px-6 py-2 rounded-md text-base outline-none focus:outline-none transition-all ${mode==='search' ? 'bg-violet-500/25 text-violet-400 font-medium' : 'text-white/40'}`}>Search</button>
      <button onClick={() => setMode('chat')} className={`w-24 px-6 py-2 rounded-md text-base outline-none focus:outline-none transition-all ${mode==='chat' ? 'bg-violet-500/25 text-violet-400 font-medium' : 'text-white/40'}`}>Chat</button>
    </div>
  </div>
  {/* RIGHT: New Chat button (chat mode only) */}
  <div className="flex justify-end">
    {mode === 'chat' && (
      <button onClick={startNewChat} className="flex items-center justify-center w-9 h-9 rounded-lg border border-white/10 text-white/40 hover:text-white/60 hover:bg-white/5 outline-none">
        <Pencil size={16} />
      </button>
    )}
  </div>
</div>
```

## RetrievalControl — Minimal Inline

Collapsed by default. Single trigger line, expands to show inline number input with +/− buttons.

```tsx
// Collapsed state:
<button onClick={toggle} className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/70 px-2 py-1.5 rounded-md hover:bg-white/5">
  <SlidersHorizontal size={11} />
  <span>{topK} results</span>
  {expanded ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
</button>

// Expanded (sibling, NOT child of trigger):
{expanded && (
  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
    <input type="number" value={inputVal} onChange={...} onBlur={apply} onKeyDown={...}
      onClick={e => e.stopPropagation()}
      className="w-16 bg-white/8 border border-violet-500/30 rounded-md px-2 py-1 text-sm text-white/80 outline-none focus:border-violet-500/60 text-center [&::-webkit-inner-spin-button]:appearance-none" />
    <button onClick={e => { e.stopPropagation(); /* increment */ }}>+</button>
    <button onClick={e => { e.stopPropagation(); /* decrement */ }}>−</button>
  </div>
)}
```

CRITICAL: +/− buttons and input must have `e.stopPropagation()` — otherwise click bubbles to parent and collapses the control. The toggle must ONLY be on the trigger button itself, never on a wrapper div.

## Chat Input — Auto-Resizing Textarea

```tsx
// Replace <input> with <textarea> for chat
<textarea
  ref={textareaRef}
  value={chatQuery}
  onChange={e => setChatQuery(e.target.value)}
  onKeyDown={e => {
    if (e.key === 'Enter' && !e.shiftKey && chatQuery.trim()) {
      e.preventDefault();
      sendMessage(chatQuery, topK);
    }
  }}
  placeholder="Ask a question about your documents..."
  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-violet-500/40 resize-none overflow-y-auto min-h-[44px] leading-relaxed"
/>
// useEffect watches chatQuery and adjusts height:
// textarea.style.height = 'auto'
// textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
```

Send button uses `self-end` to align with bottom of textarea:
```tsx
<button className="px-4 py-3 self-end rounded-xl bg-violet-600 hover:bg-violet-500 min-w-[48px]">
  <Send size={14} />
</button>
```

Input container: `px-6 pb-6 pt-3` with `max-w-3xl mx-auto w-full` on inner row.

## Chat — Empty State

```tsx
<div className="flex-1 flex items-center justify-center">
  <p className="text-sm text-white/30 text-center px-8">
    Ask anything about your documents. The {topK} most relevant passages will be used as context.
  </p>
</div>
```

## Chat — Scroll Preservation

Two refs for scroll position preservation:
- `messagesRef` + `scrollPositionRef` — for chat messages container
- `searchResultsRef` + `searchScrollPositionRef` — for search results container

Smart auto-scroll: only scrolls to bottom if `isAtBottom.current === true` (within 100px of bottom). If user scrolls up, stops following.

useEffect watches `mode` changes and restores scroll position for both containers via `setTimeout(0)`.

## Chat — View Sources Flow

Each assistant message has a "View sources (N)" button. Clicking it:
1. Calls `onViewSources(query, sources)` prop
2. Shell sets `pendingSources = { query, results }` and switches to explore search mode
3. Explore's useEffect detects `pendingSources`, pre-fills `searchQuery` and `results`
4. ONLY `searchQuery` is updated — `chatQuery` is NEVER touched

## Chat — History Drawer

History button in toolbar (left side) opens a drawer overlay:
- `showHistory` local state in Explore
- Calls `listChats(libraryPath)` when opened
- Drawer lists `ChatMeta[]` with title + date + trash icon
- Clicking a row: `loadChat(chat.chatPath)` → populate `setChatHistory` → close drawer
- `setSearchQuery('')` called when loading a chat (not chatQuery)

## Chat — Auto-Save

After each assistant reply:
1. `chatIdRef` — stable ID generated once on first message (`useRef`, format: `"2026-03-13-16-42-00"`)
2. Title = first user message truncated to 40 chars
3. `saveChat(libraryPath, { id, title, createdAt, messages })` called
4. Messages include `sources` and `query` fields for "View sources" persistence
5. `chatIdRef.current = null` on New Chat

## ReactMarkdown

```tsx
import ReactMarkdown from 'react-markdown';
<div className="prose prose-invert prose-sm max-w-none">
  <ReactMarkdown>{msg.content}</ReactMarkdown>
</div>
```

## Settings Tab

- Password input with eye/EyeOff toggle
- Model `<select>` with optgroups: Free auto / Free specific / Affordable / SOTA
- Default: `openrouter/free`
- Save calls `saveApiKey()` + `saveModelPreference()` together
- Shows green "Saved ✓" or red error
- On mount: pre-fills from `getApiKey()` and `getModelPreference()`

## Types (src/types/index.ts)

```typescript
interface SearchResult {
  id: string; docId: string; sourcePath: string; fileName: string;
  pageNumber: number | null; chunkIndex: number; text: string; score: number;
}
interface ChatMessage {
  role: 'user' | 'assistant'; content: string;
  sources?: SearchResult[];  // stored on assistant messages
  query?: string;
}
interface ChatResponse { reply: string; sources: SearchResult[]; }
interface ChatMeta { id: string; title: string; createdAt: string; chatPath: string; }
interface StoredMessage {
  role: string; content: string;
  sources?: SearchResult[];  // persisted to disk
  query?: string;
}
interface ChatData { id: string; title: string; createdAt: string; messages: StoredMessage[]; }
```

## UI Branding & Consistency

- App Name: **Matthew** (Capital M, lowercase rest — except for the sidebar which uses "MATTHEW").
- **LOCKED** Badges: Displayed when a library is locked after the first import.
  - On the selected model row in the picker.
  - On the active chunk preset in the selector.

## Hard Rules

- All `invoke()` / `listen()` in `src/lib/tauri.ts` only
- Never use `localStorage`
- Never use `keyring` — settings are file-based
- Explore AND Import must stay mounted (use `hidden` class)
- `chatCompletion` returns `ChatResponse { reply, sources }` not a string
- Search query and chat query are SEPARATE state values — never share them
- RetrievalControl +/− buttons MUST have `e.stopPropagation()`
- DM Sans font is locally bundled — never use Google Fonts CDN
