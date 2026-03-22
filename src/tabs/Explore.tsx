import { useEffect, useState, useRef } from "react";
import { Search, Send, Edit, Trash2, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { RetrievalControl } from "@/components/shared/RetrievalControl";
import { useQuery } from "@/hooks/useQuery";
import { useLibraries } from "@/hooks/useLibraries";
import { listChats, loadChat, saveChat, deleteChat } from "@/lib/tauri";
import type { SearchResult, ChatMessage, ChatMeta } from "@/types";

export interface PendingSources {
  query:   string;
  results: SearchResult[];
}

interface ExploreProps {
  libraryPath:    string | null;
  // Persisted state owned by Shell
  searchQuery:    string;
  setSearchQuery: (q: string) => void;
  chatQuery:      string;
  setChatQuery:   (q: string) => void;
  results:        SearchResult[];
  setResults:     (r: SearchResult[]) => void;
  chatHistory:    ChatMessage[];
  setChatHistory: (h: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  mode:           "search" | "chat";
  setMode:        (m: "search" | "chat") => void;
  topK:           number;
  setTopK:        (k: number) => void;
  // View-sources flow
  pendingSources?: PendingSources | null;
  onClearSources?: () => void;
  onViewSources?:  (query: string, sources: SearchResult[]) => void;
}

export default function Explore({
  libraryPath,
  searchQuery, setSearchQuery,
  chatQuery, setChatQuery,
  results, setResults,
  chatHistory, setChatHistory,
  mode, setMode,
  topK, setTopK,
  pendingSources, onClearSources, onViewSources,
}: ExploreProps) {
  const { activeLibrary } = useLibraries();
  const [showHistory, setShowHistory] = useState(false);
  const [historyChats, setHistoryChats] = useState<ChatMeta[]>([]);
  const chatIdRef = useRef<string | null>(null);
  const chatLibraryRef = useRef<string | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);
  const isAtBottom = useRef<boolean>(true);

  const searchResultsRef = useRef<HTMLDivElement>(null);
  const searchScrollPositionRef = useRef(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchTextareaRef = useRef<HTMLTextAreaElement>(null);

  const { isLoading, search, sendMessage } = useQuery({
    searchQuery, setSearchQuery, chatQuery, setChatQuery, results, setResults, chatHistory, setChatHistory,
  });

  const handleScroll = () => {
    if (!messagesRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
    scrollPositionRef.current = scrollTop;
    // Check if we are within 100px of the bottom
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  const handleSearchScroll = () => {
    if (!searchResultsRef.current) return;
    searchScrollPositionRef.current = searchResultsRef.current.scrollTop;
  };

  useEffect(() => {
    if (isAtBottom.current && messagesRef.current) {
      messagesRef.current.scrollTo({
        top: messagesRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [chatHistory, isLoading]);

  useEffect(() => {
    if (mode === "chat") {
      setTimeout(() => {
        if (messagesRef.current) {
          messagesRef.current.scrollTop = scrollPositionRef.current;
        }
      }, 0);
    } else if (mode === "search") {
      setTimeout(() => {
        if (searchResultsRef.current) {
          searchResultsRef.current.scrollTop = searchScrollPositionRef.current;
        }
      }, 0);
    }
  }, [mode]);

  // (State is cleared synchronously during render when libraryPath changes)

  // Auto-resize chat textarea
  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
  }, [chatQuery]);

  // Auto-resize search textarea
  useEffect(() => {
    if (!searchTextareaRef.current) return;
    searchTextareaRef.current.style.height = "auto";
    searchTextareaRef.current.style.height = Math.min(searchTextareaRef.current.scrollHeight, 160) + "px";
  }, [searchQuery]);

  // Auto-save logic
  useEffect(() => {
    if (!libraryPath || chatHistory.length === 0) return;
    
    // Check if the last message is from the assistant (meaning the exchange is complete)
    // and we're not currently loading.
    const lastMsg = chatHistory[chatHistory.length - 1];
    if (lastMsg.role === "assistant" && !isLoading) {
       if (!chatIdRef.current) {
          // generate a new id
          const now = new Date();
          chatIdRef.current = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
          chatLibraryRef.current = libraryPath;
       }
       // generate title from first user message
       const firstUserMsg = chatHistory.find(m => m.role === "user");
       const title = firstUserMsg 
         ? firstUserMsg.content.slice(0, 40) + (firstUserMsg.content.length > 40 ? "..." : "")
         : "New Chat";
         
       // Save to backend
       saveChat(chatLibraryRef.current!, {
          id: chatIdRef.current,
          title,
          createdAt: new Date().toISOString(),
          messages: chatHistory.map(m => ({
            role: m.role,
            content: m.content,
            sources: m.sources,
            query: m.query
          }))
       }).catch(console.error);
    }
  }, [chatHistory, isLoading, libraryPath]);

  const handleNewChat = () => {
    setChatHistory([]);
    setChatQuery('');
    chatIdRef.current = null;
    chatLibraryRef.current = null;
    setShowHistory(false);
  };

  const loadHistory = async () => {
    if (!libraryPath) return;
    try {
       const chats = await listChats(libraryPath);
       console.log('listChats result:', chats);
       setHistoryChats(chats);
    } catch (e) {
       console.error("Failed to load chats:", e);
    }
  };

  const handleToggleHistory = () => {
    if (!showHistory) {
      loadHistory();
    }
    setShowHistory(v => !v);
  };

  const handleLoadChat = async (meta: ChatMeta) => {
     try {
       const data = await loadChat(meta.chatPath);
       setChatHistory(data.messages.map(m => ({
         role: m.role as "system" | "user" | "assistant",
         content: m.content,
         sources: m.sources ?? undefined,
         query: m.query ?? undefined
       })));
       setChatQuery('');
       chatIdRef.current = data.id;
       setShowHistory(false);
     } catch (e) {
       console.error("Failed to load chat:", e);
     }
  };

  const handleDeleteChat = async (e: React.MouseEvent, meta: ChatMeta) => {
     e.stopPropagation();
     try {
        await deleteChat(meta.chatPath);
        if (chatIdRef.current === meta.id) {
           handleNewChat();
        }
        loadHistory();
     } catch (err) {
        console.error("Failed to delete chat:", err);
     }
  };

  // When Shell injects sources from a "View sources" click, switch to search
  // mode and display them without running a new search.
  useEffect(() => {
    if (!pendingSources) return;
    setSearchQuery(pendingSources.query);
    setResults(pendingSources.results);
    setMode("search");
    onClearSources?.();
  }, [pendingSources]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeLibrary) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600 p-8">
        <Search size={36} strokeWidth={1} />
        <p className="text-sm">Open a library to start searching.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: unified toolbar */}
      <div className="grid grid-cols-3 items-center px-4 py-2 border-b border-white/5 shrink-0 relative">
        
        {/* LEFT */}
        <div className="flex items-center gap-2">
          {mode === 'chat' && libraryPath && (
            <button onClick={() => { listChats(libraryPath).then(chats => { setHistoryChats(chats); setShowHistory(true); }); }}
              className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/70 transition-colors px-2 py-1.5 rounded-md hover:bg-white/5">
              <Clock size={13} />
              <span>History</span>
            </button>
          )}
          <RetrievalControl topK={topK} onChange={setTopK} mode={mode} />
        </div>

        {/* CENTER */}
        <div className="flex justify-center">
          <div style={{display:'flex', background:'rgba(255,255,255,0.06)', borderRadius:'8px', padding:'3px', gap:'2px'}}>
            <button className="outline-none focus:outline-none focus:ring-0 w-24" onClick={() => setMode('search')} style={{padding:'8px 24px', borderRadius:'6px', border:'none', outline:'none', background: mode==='search' ? 'rgba(139,92,246,0.25)' : 'transparent', color: mode==='search' ? '#a78bfa' : 'rgba(255,255,255,0.45)', fontWeight: mode==='search' ? 500 : 400, cursor:'pointer', fontSize:'16px'}}>Search</button>
            <button className="outline-none focus:outline-none focus:ring-0 w-24" onClick={() => setMode('chat')} style={{padding:'8px 24px', borderRadius:'6px', border:'none', outline:'none', background: mode==='chat' ? 'rgba(139,92,246,0.25)' : 'transparent', color: mode==='chat' ? '#a78bfa' : 'rgba(255,255,255,0.45)', fontWeight: mode==='chat' ? 500 : 400, cursor:'pointer', fontSize:'16px'}}>Chat</button>
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex items-center justify-end gap-2">
          {mode === "chat" ? (
            <button
               onClick={handleNewChat}
               className="flex items-center justify-center w-9 h-9 rounded-lg border border-white/10 text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors outline-none"
               title="New Chat"
            >
               <Edit size={16} />
            </button>
          ) : (
            <div className="w-8 h-8" /> /* placeholder to keep layout balanced */
          )}
        </div>
      </div>

      {mode === "search" && (
        <div 
          ref={searchResultsRef}
          onScroll={handleSearchScroll}
          className="flex flex-col gap-4 p-5 flex-1 overflow-auto"
        >

          <div className="flex items-end gap-2">
            <textarea
              ref={searchTextareaRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  search(topK);
                }
              }}
              placeholder="Search your documents…"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-violet-500/40 resize-none overflow-y-auto min-h-[44px] max-h-[160px] leading-relaxed"
              rows={1}
            />
            <button onClick={() => search(topK)}
              disabled={isLoading}
              className="h-[44px] w-[44px] flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-500 shrink-0 disabled:opacity-40 transition-colors">
              <Search size={14} className="text-white" />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {results.map((r, i) => (
              <div key={i} className="bg-white/5 rounded-xl border border-white/5 hover:bg-white/[0.07] transition-colors duration-150">
                <div className="flex items-center px-4 pt-4 pb-3 border-b border-white/5">
                  <span className="text-sm font-medium text-white/90 truncate flex-1">{r.fileName}</span>
                  <span className="text-xs bg-violet-500/15 text-violet-400 rounded-full px-2 py-0.5 shrink-0 ml-3">
                    {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="px-4 pb-4 pt-3">
                  <p className="text-sm text-white/50 leading-relaxed">{r.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === "chat" && (
        <div className="flex flex-col flex-1 overflow-hidden relative">
          {/* History Drawer Overlay */}
          {showHistory && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowHistory(false)} 
              />
              <div className="absolute top-0 left-0 bottom-0 w-[280px] bg-[#0c0c16] border-r border-white/10 z-20 flex flex-col shadow-2xl">
                <div className="p-4 border-b border-white/5 font-medium text-sm text-white/80">
                   Chat History
                </div>
                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                   {historyChats.length === 0 ? (
                      <p className="text-xs text-white/40 text-center p-4">No recent chats.</p>
                   ) : (
                      historyChats.map(meta => (
                         <div 
                           key={meta.id} 
                           onClick={() => handleLoadChat(meta)}
                           className={cn("group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors", chatIdRef.current === meta.id ? "bg-violet-500/15" : "hover:bg-white/5")}
                         >
                            <div className="flex flex-col gap-1 overflow-hidden pr-2">
                               <span className={cn("text-sm truncate", chatIdRef.current === meta.id ? "text-violet-300 font-medium" : "text-white/80")}>{meta.title}</span>
                               <span className="text-xs text-white/40">
                                  {new Date(meta.createdAt).toLocaleDateString()} {new Date(meta.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                               </span>
                            </div>
                            <button 
                              onClick={(e) => handleDeleteChat(e, meta)}
                              className="p-1.5 rounded-md text-white/30 hover:text-red-400 hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                            >
                               <Trash2 size={14} />
                            </button>
                         </div>
                      ))
                   )}
                </div>
              </div>
            </>
          )}

          <div 
            ref={messagesRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto w-full flex flex-col"
          >
            <div className={cn("max-w-4xl mx-auto w-full px-6 py-4 flex flex-col gap-4", chatHistory.length === 0 && "flex-1")}>
              {chatHistory.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center">
                  <p className="text-sm text-white/30 text-center leading-relaxed">
                    Ask anything about your documents.<br/>
                    The {topK} most relevant passages will be used as context.
                  </p>
                </div>
              ) : (
                <div className="h-4" /> /* Spacer at top */
              )}
              
              {chatHistory.map((msg, i) => (
                <div key={i} className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
                  <div className={cn(
                    "rounded-2xl px-4 py-2.5",
                    msg.role === "user"
                      ? "bg-violet-600 text-white rounded-br-sm ml-auto max-w-[75%] text-[15px]"
                      : "bg-white/5 text-white/80 rounded-bl-sm w-full text-base leading-7"
                  )}>
                    {msg.role === "assistant" ? (
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {/* View sources button — only on assistant messages that have sources */}
                  {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && onViewSources && (
                    <button
                      onClick={() => onViewSources(msg.query ?? "", msg.sources!)}
                      className="mt-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors px-1"
                    >
                      View sources ({msg.sources.length})
                    </button>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-800 px-3 py-2 rounded-xl rounded-bl-sm">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <span key={i}
                          className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} className="h-1 shrink-0" />
            </div>
          </div>

          <div className="px-6 pb-6 pt-3 flex gap-2 shrink-0 justify-center">
            <div className="max-w-4xl mx-auto w-full flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={chatQuery}
                onChange={e => setChatQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (chatQuery.trim()) sendMessage(chatQuery, topK);
                  }
                }}
                placeholder="Ask a question about your documents…"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-violet-500/40 resize-none overflow-y-auto min-h-[44px] max-h-[200px] leading-relaxed"
                rows={1}
              />
              <button
                onClick={() => sendMessage(chatQuery, topK)}
                disabled={isLoading || !chatQuery.trim()}
                className="h-[44px] w-[44px] flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 shrink-0 disabled:opacity-40 transition-colors"
              >
                <Send size={15} className="text-white relative" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
