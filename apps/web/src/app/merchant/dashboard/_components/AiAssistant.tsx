'use client';

import { useState, useRef, useEffect, createContext, useContext } from 'react';
import { X, Send, Sparkles, Bot, Loader2, CheckCircle, Package, ImagePlus, Copy, Check, ExternalLink } from 'lucide-react';
import type Anthropic from '@anthropic-ai/sdk';

/* ── Shared context so sidebar can trigger the panel ── */
interface AiCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  agentName: string;
  setAgentName: (n: string) => void;
  agentEnabled: boolean;
  setAgentEnabled: (v: boolean) => void;
}
const AiContext = createContext<AiCtx>({
  open: false, setOpen: () => {},
  agentName: 'Ubongo AI', setAgentName: () => {},
  agentEnabled: true, setAgentEnabled: () => {},
});
export const useAiAssistant = () => useContext(AiContext);

const LINK_RE = /https?:\/\/[a-zA-Z0-9._:-]+\/m\/[a-zA-Z0-9_-]+(?:\?link=[a-zA-Z0-9_-]+)?/g;

function parseMessage(text: string): { prose: string; links: string[] } {
  const links = Array.from(new Set(text.match(LINK_RE) ?? []));
  // Strip URLs and clean up leftover separators / extra spaces
  const prose = text
    .replace(LINK_RE, '')
    .replace(/\s*---+\s*/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { prose, links };
}

function LinkCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const display = url.replace('https://', '');

  return (
    <div className="flex items-center gap-2 border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-emerald-400/70 tracking-wide truncate">{display}</p>
      </div>
      <button
        onClick={copy}
        className="flex items-center gap-1.5 shrink-0 border border-white/10 px-2.5 py-1 text-[10px] text-white/40 hover:text-white/80 hover:border-white/25 transition-colors"
      >
        {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 flex items-center justify-center h-6 w-6 border border-white/10 text-white/30 hover:text-white/70 hover:border-white/25 transition-colors"
      >
        <ExternalLink size={10} />
      </a>
    </div>
  );
}

interface PendingAction {
  type: 'create_product' | 'create_promo';
  data: {
    productName?: string;
    type?: string;
    amountTzs?: number;
    originalAmountTzs?: number;
    discountPct?: number;
    description?: string;
    imageUrl?: string;
  };
}

interface PendingImage {
  preview: string;    // data URL for display
  base64: string;     // raw base64 for API
  mimeType: string;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  imagePreview?: string;
  action?: PendingAction | null;
  createdLinkId?: string;
}

// What we actually send to the API
type ApiMessage = Anthropic.MessageParam;

const STARTERS = [
  'Nionyeshe mauzo yangu',
  'Ongeza bidhaa mpya',
  'Tengeneza promo',
  'Nishirikishie store link',
];

function toApiMessages(messages: Message[]): ApiMessage[] {
  return messages.map(m => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.text };
    // user message — may include an image
    if (m.imagePreview && m.imagePreview.startsWith('data:')) {
      const [header, base64] = m.imagePreview.split(',');
      const mimeType = (header.match(/:(.*?);/) ?? [])[1] ?? 'image/jpeg';
      const content: Anthropic.ContentBlockParam[] = [
        { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 } },
      ];
      if (m.text) content.push({ type: 'text', text: m.text });
      return { role: 'user', content };
    }
    return { role: 'user', content: m.text };
  });
}

async function compressImage(file: File, maxPx = 1024): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.src = blobUrl;
  });
}

export function AiAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [agentName, setAgentNameState] = useState('Ubongo AI');
  const [agentEnabled, setAgentEnabledState] = useState(true);

  useEffect(() => {
    const name = localStorage.getItem('biashara-ai-name');
    const enabled = localStorage.getItem('biashara-ai-enabled');
    if (name) setAgentNameState(name);
    if (enabled !== null) setAgentEnabledState(enabled !== 'false');
  }, []);

  function setAgentName(n: string) {
    setAgentNameState(n);
    localStorage.setItem('biashara-ai-name', n);
  }
  function setAgentEnabled(v: boolean) {
    setAgentEnabledState(v);
    localStorage.setItem('biashara-ai-enabled', String(v));
    if (!v) setOpen(false);
  }

  return (
    <AiContext.Provider value={{ open, setOpen, agentName, setAgentName, agentEnabled, setAgentEnabled }}>
      {children}
      <AiPanel />
    </AiContext.Provider>
  );
}

export function AiAssistant() {
  const { open, setOpen, agentName, agentEnabled } = useAiAssistant();
  if (!agentEnabled) return null;
  return (
    <>
      <style>{`
        @keyframes ubongo-float {
          0%, 100% { transform: translateY(0px) scale(1); }
          30%       { transform: translateY(-10px) scale(1.04); }
          60%       { transform: translateY(-5px) scale(1.02); }
        }
        @keyframes ubongo-spin {
          0%   { transform: rotate(0deg)   scale(1); }
          25%  { transform: rotate(90deg)  scale(1.15); }
          50%  { transform: rotate(180deg) scale(1); }
          75%  { transform: rotate(270deg) scale(1.15); }
          100% { transform: rotate(360deg) scale(1); }
        }
        @keyframes ubongo-glow {
          0%, 100% { box-shadow: 0 0 0px 0px rgba(52,211,153,0); }
          50%       { box-shadow: 0 0 18px 4px rgba(52,211,153,0.25); }
        }
        .ubongo-btn-idle {
          animation: ubongo-float 2.8s ease-in-out infinite, ubongo-glow 2.8s ease-in-out infinite;
        }
        .ubongo-icon-idle {
          animation: ubongo-spin 3.5s cubic-bezier(0.4,0,0.2,1) infinite;
        }
      `}</style>

      <button
        onClick={() => setOpen(!open)}
        aria-label="Ubongo AI"
        className={`fixed bottom-6 right-6 z-50 group items-center gap-0 overflow-hidden border border-emerald-500/50 bg-emerald-500/15 text-emerald-400 shadow-lg shadow-emerald-900/30 backdrop-blur hover:bg-emerald-500/25 transition-colors h-12 pl-3.5 pr-3.5 hover:gap-2 hover:pr-4 ${!open ? 'ubongo-btn-idle' : ''} ${open ? 'hidden sm:flex' : 'flex'}`}
      >
        {/* Pulse rings — closed only */}
        {!open && (
          <>
            <span className="absolute inset-0 animate-ping border border-emerald-400/25" style={{ animationDuration: '2.8s' }} />
            <span className="absolute inset-0 animate-ping border border-emerald-400/10" style={{ animationDuration: '2.8s', animationDelay: '0.7s' }} />
          </>
        )}

        <span className={`shrink-0 ${!open ? 'ubongo-icon-idle' : ''}`}>
          {open ? <X size={18} /> : <Sparkles size={18} />}
        </span>

        <span className="text-[10px] tracking-widest uppercase whitespace-nowrap max-w-0 overflow-hidden group-hover:max-w-[120px] transition-all duration-300 opacity-0 group-hover:opacity-100">
          {agentName}
        </span>
      </button>
    </>
  );
}

function AiPanel() {
  const { open, setOpen, agentName } = useAiAssistant();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
      if (messages.length === 0) {
        setMessages([{ role: 'assistant', text: 'Karibu! Una nini leo — bidhaa mpya, promo, au unataka kuona mauzo?' }]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await compressImage(file);
    const [header, base64] = dataUrl.split(',');
    const mimeType = (header.match(/:(.*?);/) ?? [])[1] ?? 'image/jpeg';
    setPendingImage({ preview: dataUrl, base64, mimeType });
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content && !pendingImage) return;
    if (loading) return;

    const userMsg: Message = {
      role: 'user',
      text: content,
      imagePreview: pendingImage?.preview,
    };

    const capturedImagePreview = pendingImage?.preview ?? null;
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setPendingImage(null);
    setLoading(true);

    try {
      const res = await fetch('/merchant/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: toApiMessages(next), agentName }),
      });
      const data = await res.json() as { reply: string; action: PendingAction | null };
      // Attach the uploaded image to the draft so it saves with the product
      if (data.action && capturedImagePreview) {
        data.action.data.imageUrl = capturedImagePreview;
      }
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply, action: data.action }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Kuna tatizo kidogo — jaribu tena.' }]);
    } finally {
      setLoading(false);
    }
  }

  async function confirmAction(action: PendingAction) {
    setConfirming(true);
    try {
      const isPromo = action.type === 'create_promo';
      const body = isPromo
        ? { type: 'fixed', productName: action.data.productName, originalAmountTzs: action.data.originalAmountTzs, discountPct: action.data.discountPct, description: action.data.description, imageUrl: action.data.imageUrl }
        : { type: action.data.type ?? 'fixed', productName: action.data.productName, amountTzs: action.data.amountTzs, description: action.data.description, imageUrl: action.data.imageUrl };

      const res = await fetch('/merchant/api/merchant/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setMessages(prev => [...prev, { role: 'assistant', text: err.error ?? 'Hitilafu — angalia bei lazima iwe 100 TZS au zaidi.' }]);
        return;
      }

      const { link } = await res.json() as { link: { id: string; productName: string | null; amountTzs: number | null } };
      setMessages(prev => {
        const updated = prev.map((m, i) => i === prev.length - 1 && m.action ? { ...m, action: null } : m);
        return [...updated, { role: 'assistant', text: `Imefanywa! "${link.productName ?? 'Bidhaa'}"${link.amountTzs ? ` — ${link.amountTzs.toLocaleString()} TZS` : ''} iko tayari.`, createdLinkId: link.id }];
      });
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Haikufanya kazi — jaribu tena.' }]);
    } finally {
      setConfirming(false);
    }
  }

  function dismissAction() {
    setMessages(prev => prev.map((m, i) => i === prev.length - 1 && m.action ? { ...m, action: null } : m));
  }

  const canSend = (input.trim() || !!pendingImage) && !loading;

  return (
    <>
      {/* Backdrop — mobile */}
      {open && <div className="fixed inset-0 z-30 bg-black/50 sm:hidden" onClick={() => setOpen(false)} />}

      {/* Panel — sits above the floating button on desktop (bottom-20 = 48px button + 8px gap + 24px margin) */}
      <div
        className={`fixed bottom-0 right-0 z-40 flex flex-col transition-transform duration-300 ease-out w-full sm:w-[380px] sm:bottom-20 sm:right-6 ${open ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ maxHeight: 'calc(100dvh - 6rem)' }}
      >
        <div className="flex flex-col h-full border border-emerald-500/20 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 bg-black/40 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center border border-emerald-500/30 bg-emerald-500/10">
                <Bot size={13} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-bold tracking-wider text-white uppercase">{agentName}</p>
                <p className="text-[10px] text-white/30 tracking-wide">msaidizi wa duka lako</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <button onClick={() => setOpen(false)} className="flex items-center justify-center h-9 w-9 sm:h-auto sm:w-auto text-white/30 hover:text-white/70 transition-colors ml-1">
                <X size={18} className="sm:hidden" />
                <X size={15} className="hidden sm:block" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ minHeight: 0 }}>
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="flex h-6 w-6 shrink-0 mt-0.5 items-center justify-center border border-emerald-500/25 bg-emerald-500/[0.08]">
                    <Sparkles size={11} className="text-emerald-400" />
                  </div>
                )}
                <div className="flex flex-col gap-2 max-w-[85%]">
                  {/* Image preview for user messages */}
                  {m.imagePreview && (
                    <img
                      src={m.imagePreview}
                      alt=""
                      className={`max-h-40 w-auto object-cover border ${m.role === 'user' ? 'border-emerald-500/25 ml-auto' : 'border-white/10'}`}
                    />
                  )}
                  {m.role === 'user' ? (
                    m.text && (
                      <div className="px-3 py-2.5 text-xs leading-relaxed bg-emerald-500/15 border border-emerald-500/25 text-white/90">
                        {m.text}
                      </div>
                    )
                  ) : (
                    (() => {
                      const { prose, links } = parseMessage(m.text);
                      return (
                        <>
                          {prose && (
                            <div className="px-3 py-2.5 text-xs leading-relaxed bg-white/[0.04] border border-white/8 text-white/80 whitespace-pre-line">
                              {prose}
                            </div>
                          )}
                          {links.map(url => <LinkCard key={url} url={url} />)}
                        </>
                      );
                    })()
                  )}
                  {m.role === 'assistant' && m.action && (
                    <ActionCard action={m.action} onConfirm={() => confirmAction(m.action!)} onDismiss={dismissAction} loading={confirming} />
                  )}
                  {m.role === 'assistant' && m.createdLinkId && (
                    <a
                      href="/merchant/dashboard/links"
                      className="flex items-center gap-2 border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/20 transition-colors"
                    >
                      <ExternalLink size={10} />
                      View in Products
                    </a>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2 justify-start">
                <div className="flex h-6 w-6 shrink-0 mt-0.5 items-center justify-center border border-emerald-500/25 bg-emerald-500/[0.08]">
                  <Sparkles size={11} className="text-emerald-400" />
                </div>
                <div className="bg-white/[0.04] border border-white/8 px-3 py-2.5 flex items-center gap-2">
                  <Loader2 size={11} className="text-emerald-400/50 animate-spin" />
                  <span className="text-[10px] text-white/30">inafikiri...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Starters */}
          {messages.length <= 1 && !loading && (
            <div className="px-4 pb-2 flex flex-wrap gap-2 sm:gap-1.5 shrink-0">
              {STARTERS.map(s => (
                <button key={s} onClick={() => send(s)} className="px-3 py-2 sm:px-2.5 sm:py-1 border border-white/10 text-xs sm:text-[10px] text-white/40 hover:border-emerald-500/30 hover:text-emerald-400/80 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Image preview strip */}
          {pendingImage && (
            <div className="px-3 pb-1 shrink-0">
              <div className="relative inline-block">
                <img src={pendingImage.preview} alt="" className="h-16 w-auto object-cover border border-white/15" />
                <button onClick={() => setPendingImage(null)} className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center bg-zinc-800 border border-white/20 text-white/60 hover:text-white">
                  <X size={9} />
                </button>
              </div>
            </div>
          )}

          {/* Input row */}
          <div className="border-t border-white/8 px-3 py-3 sm:px-3 sm:py-3 flex items-center gap-3 sm:gap-2 bg-black/30 shrink-0">
            <label
              className={`flex h-11 w-11 sm:h-7 sm:w-7 shrink-0 items-center justify-center text-white/25 hover:text-emerald-400/70 transition-colors cursor-pointer ${loading ? 'pointer-events-none opacity-30' : ''}`}
              title="Pakia picha"
            >
              <ImagePlus size={20} className="sm:hidden" />
              <ImagePlus size={14} className="hidden sm:block" />
              <input type="file" accept="image/*" className="sr-only" onChange={onFileChange} disabled={loading} />
            </label>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Andika hapa..."
              className="flex-1 bg-transparent text-sm sm:text-xs text-white/80 placeholder-white/25 outline-none"
              disabled={loading}
            />
            <button
              onClick={() => send()}
              disabled={!canSend}
              className="flex h-11 w-11 sm:h-7 sm:w-7 shrink-0 items-center justify-center border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 disabled:opacity-30 hover:bg-emerald-500/20 transition-colors"
            >
              <Send size={16} className="sm:hidden" />
              <Send size={11} className="hidden sm:block" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ActionCard({ action, onConfirm, onDismiss, loading }: {
  action: PendingAction;
  onConfirm: () => void;
  onDismiss: () => void;
  loading: boolean;
}) {
  const isPromo = action.type === 'create_promo';
  const discounted = isPromo && action.data.originalAmountTzs && action.data.discountPct
    ? Math.round(action.data.originalAmountTzs * (1 - action.data.discountPct / 100))
    : null;

  return (
    <div className="border border-emerald-500/25 bg-emerald-500/[0.05] p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Package size={11} className="text-emerald-400/70 shrink-0" />
        <p className="text-[9px] tracking-widest text-emerald-400/70 uppercase">
          {isPromo ? 'Promo' : 'Bidhaa mpya'}
        </p>
      </div>
      <div className="space-y-0.5">
        <p className="text-xs font-semibold text-white/90">{action.data.productName}</p>
        {action.data.description && (
          <p className="text-[10px] text-white/40 leading-relaxed">{action.data.description}</p>
        )}
        <div className="flex items-baseline gap-2 pt-1">
          {isPromo && discounted ? (
            <>
              <span className="text-sm font-bold text-emerald-400">{discounted.toLocaleString()} TZS</span>
              <span className="text-[10px] text-white/30 line-through">{action.data.originalAmountTzs?.toLocaleString()}</span>
              <span className="text-[10px] text-emerald-400/70">-{action.data.discountPct}%</span>
            </>
          ) : action.data.amountTzs ? (
            <span className="text-sm font-bold text-white/80">{action.data.amountTzs.toLocaleString()} TZS</span>
          ) : (
            <span className="text-[10px] text-white/40">Mteja anaweka bei</span>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-1.5 border border-emerald-500/40 bg-emerald-500/15 py-2 text-[10px] tracking-widest text-emerald-400 uppercase hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
          {loading ? 'Inaunda...' : 'Thibitisha'}
        </button>
        <button onClick={onDismiss} disabled={loading} className="px-3 border border-white/10 py-2 text-[10px] text-white/30 uppercase hover:text-white/50 hover:border-white/20 transition-colors disabled:opacity-50">
          Acha
        </button>
      </div>
    </div>
  );
}
