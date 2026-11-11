// Chatbot di pojok kanan bawah. Bisa ditanya soal saldo, pengeluaran, anggaran, dll.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageCircle, SendHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { api, errorMessage } from "@/lib/api";
import { today } from "@/lib/format";
import type { ChatMessage, User } from "@/lib/types";
import { Button, useFeedback } from "./ui";

const SUGGESTIONS = ["Berapa pengeluaranku bulan ini?", "Kategori apa yang paling boros?", "Gimana kondisi anggaranku?", "Ada utang yang jatuh tempo?"];

/** Menampilkan teks jawaban: **tebal**, daftar "- " / "1. ", dan baris baru. Tanpa HTML mentah, jadi aman. */
function RichText({ text }: { text: string }) {
  const bold = (line: string, key: number): ReactNode => (
    <span key={key}>{line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part))}</span>
  );
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={cn("my-1 space-y-0.5 pl-5", list.ordered ? "list-decimal" : "list-disc")}>
        {list.items.map((item, i) => (
          <li key={i}>{bold(item, i)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flush();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{bold(line.replace(/^#+\s*/, ""), 0)}</p>);
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

export function ChatWidget({ user }: { user: User }) {
  const { toast, confirm } = useFeedback();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"ai" | "basic">("basic");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    api<{ messages: ChatMessage[]; mode: "ai" | "basic" }>("/chat")
      .then((r) => {
        setMessages(r.messages);
        setMode(r.mode);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    if (open) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, sending, open, loaded]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function send(content: string) {
    const message = content.trim();
    if (!message || sending) return;
    setText("");
    setSending(true);
    setMessages((list) => [...list, { id: `u-${Date.now()}`, role: "user", content: message }]);
    try {
      const r = await api<{ id: number; reply: string; mode: "ai" | "basic"; notice?: string }>("/chat", { method: "POST", body: { message, today: today() } });
      setMessages((list) => [...list, { id: r.id, role: "assistant", content: r.notice ? `${r.reply}\n\n_${r.notice}_` : r.reply, mode: r.mode }]);
    } catch (err) {
      setMessages((list) => [...list, { id: `e-${Date.now()}`, role: "assistant", content: `Maaf, pesanmu belum terkirim. ${errorMessage(err)}`, mode: "error" }]);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  async function clear() {
    if (!(await confirm({ title: "Hapus riwayat obrolan?", message: "Semua pesan di obrolan ini akan dihapus. Data keuanganmu tidak terpengaruh.", confirmLabel: "Hapus", danger: true }))) return;
    try {
      await api("/chat", { method: "DELETE" });
      setMessages([]);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const firstName = user.name.split(" ")[0];

  return (
    <div className="no-print">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Buka asisten keuangan"
          title="Tanya asisten keuangan"
          className="group fixed right-4 bottom-4 z-40 flex h-14 items-center rounded-full bg-ink px-4 text-white shadow-pop transition-transform hover:-translate-y-0.5 sm:right-6 sm:bottom-6"
        >
          <MessageCircle className="h-6 w-6 shrink-0" aria-hidden />
          {/* Tulisan baru muncul saat tombol diarahkan/difokus, supaya tidak menutupi isi halaman */}
          <span className="max-w-0 overflow-hidden text-sm font-semibold whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-2 group-hover:max-w-40 group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-40 group-focus-visible:opacity-100">
            Tanya asisten
          </span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Asisten keuangan"
          className="animate-pop fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[min(620px,calc(100vh-3.5rem))] sm:w-[400px] sm:rounded-3xl sm:border sm:border-line sm:shadow-pop"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        >
          <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white" aria-hidden>
              <Sparkles className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-tight font-bold">Asisten Keuangan</p>
              <p className="text-xs text-muted">{mode === "ai" ? "Dijawab AI berdasarkan datamu" : "Mode dasar · menjawab dari datamu"}</p>
            </div>
            {messages.length > 0 && (
              <Button variant="ghost" size="icon" onClick={clear} aria-label="Hapus riwayat obrolan" title="Hapus riwayat">
                <Trash2 className="h-[18px] w-[18px]" aria-hidden />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Tutup asisten">
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </header>

          <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {loaded && messages.length === 0 && (
              <div className="px-1 pt-2">
                <p className="text-lg font-bold tracking-tight">Halo, {firstName}!</p>
                <p className="mt-1 text-sm text-muted">Tanya apa saja soal keuanganmu. Aku menjawab berdasarkan catatan yang ada di aplikasi ini.</p>
                <div className="mt-4 flex flex-col items-start gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line-strong px-3.5 py-2 text-left text-[13px] font-medium transition-colors hover:bg-paper">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words",
                    m.role === "user" ? "rounded-br-md bg-ink text-white" : m.mode === "error" ? "rounded-bl-md bg-bad-soft text-bad" : "rounded-bl-md bg-paper text-ink",
                  )}
                >
                  {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <RichText text={m.content.replace(/_([^_\n]+)_$/, "$1")} />}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start" role="status" aria-label="Asisten sedang mengetik">
                <div className="flex gap-1 rounded-2xl rounded-bl-md bg-paper px-4 py-3.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted" style={{ animation: `dot 1.2s ${i * 0.15}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <form
            className="border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-white p-1.5 pl-3.5 focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/10">
              <textarea
                ref={input}
                rows={1}
                maxLength={1000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(text);
                  }
                }}
                placeholder="Tulis pertanyaanmu…"
                aria-label="Pesan untuk asisten"
                className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-faint"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              <Button type="submit" size="icon" disabled={!text.trim() || sending} aria-label="Kirim pesan">
                <SendHorizontal className="h-[18px] w-[18px]" aria-hidden />
              </Button>
            </div>
            <p className="mt-2 px-1 text-[11px] leading-snug text-faint">
              {mode === "ai" ? "Jawaban AI bisa keliru. Cek lagi angka penting di menu Laporan." : "Mode dasar hanya paham pertanyaan umum (saldo, pengeluaran, anggaran, utang). AI bisa diaktifkan lewat file .env."}
            </p>
          </form>
        </section>
      )}
    </div>
  );
}
