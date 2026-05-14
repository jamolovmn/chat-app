"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  getMatrixClient, sendMessage, sendReply, editMessage, deleteMessage,
  sendTyping, showNotification, sendImage, sendFile, sendVoiceMessage,
  sendLocation, fetchMediaBlob, markRoomAsRead,
} from "@/lib/matrix";

interface Props { roomId: string; roomName: string; onBack: () => void; onVideoCall: () => void; }

interface Message {
  id: string;
  sender: string;
  senderName: string;
  body: string;
  timestamp: Date;
  isOwn: boolean;
  type: "text" | "audio" | "image" | "file" | "location" | "call" | "deleted";
  mxcUrl?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  geoLat?: number;
  geoLng?: number;
  replyTo?: { sender: string; body: string; id: string };
  edited?: boolean;
}

const COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9"];
function getColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}
function fmtSize(b: number) {
  if (!b) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

// =====================================================================
// AUDIO SINGLETON — bitta global audio play. Boshqa audio play bossa
// avvalgisi to'xtaydi (Telegram/WhatsApp uslubi)
// =====================================================================
let _activeAudio: HTMLAudioElement | null = null;
function setActiveAudio(audio: HTMLAudioElement | null) {
  if (_activeAudio && _activeAudio !== audio) {
    try { _activeAudio.pause(); } catch {}
  }
  _activeAudio = audio;
}
function clearActiveAudio(audio: HTMLAudioElement) {
  if (_activeAudio === audio) _activeAudio = null;
}

// =====================================================================
// VAQT FORMATLASH — sana bilan
// =====================================================================
function formatMessageTime(d: Date): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const sameYear = d.getFullYear() === now.getFullYear();

  const time = d.toLocaleTimeString("uz", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  if (isYesterday) return `Kecha ${time}`;
  if (sameYear) return d.toLocaleDateString("uz", { day: "numeric", month: "short" }) + " " + time;
  return d.toLocaleDateString("uz", { day: "numeric", month: "short", year: "numeric" }) + " " + time;
}

// Date separator (bitta kun bo'yicha grupp)
function getDateLabel(d: Date): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (sameDay) return "Bugun";
  if (isYesterday) return "Kecha";
  return d.toLocaleDateString("uz", { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

// =====================================================================
// MEDIA IMAGE — blob URL + lightbox modal
// =====================================================================
function MediaImage({ mxcUrl, fileName, onOpen }: { mxcUrl?: string; fileName?: string; onOpen: (url: string) => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!mxcUrl) { setLoading(false); return; }
    let cancelled = false;
    fetchMediaBlob(mxcUrl).then(url => {
      if (cancelled) return;
      if (url) setBlobUrl(url);
      else setError(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [mxcUrl]);

  if (loading) {
    return <div className="w-[200px] h-[200px] rounded-2xl bg-surface-variant flex items-center justify-center animate-pulse">
      <span className="material-symbols-outlined text-outline">image</span>
    </div>;
  }
  if (error || !blobUrl) {
    return <div className="w-[200px] h-[150px] rounded-2xl bg-surface-variant flex flex-col items-center justify-center gap-1">
      <span className="material-symbols-outlined text-outline text-[32px]">broken_image</span>
      <span className="text-[11px] text-outline">{fileName || "Rasm yuklanmadi"}</span>
    </div>;
  }
  return (
    <button onClick={() => onOpen(blobUrl)} className="block max-w-[260px]">
      <img src={blobUrl} alt={fileName || "image"} className="rounded-2xl w-full h-auto object-cover" loading="lazy" />
    </button>
  );
}

// =====================================================================
// LOCATION BUBBLE — Telegram-uslubidagi xarita preview
// =====================================================================
function LocationBubble({ lat, lng, isOwn }: { lat: number; lng: number; isOwn: boolean }) {
  const [mapStage, setMapStage] = useState(0); // 0=yandex, 1=osm, 2=text
  const mapUrls = [
    `https://static-maps.yandex.ru/1.x/?ll=${lng},${lat}&z=15&size=300,180&l=map&pt=${lng},${lat},pm2rdm`,
    `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=300x180&markers=${lat},${lng},red-pushpin`,
  ];
  const externalUrl = `https://maps.google.com/?q=${lat},${lng}`;

  return (
    <a
      href={externalUrl}
      target="_blank"
      rel="noreferrer"
      className={`block w-[280px] rounded-2xl overflow-hidden ${isOwn ? "bg-primary-container" : "bg-surface-variant"}`}
    >
      <div className="relative w-full h-[180px] bg-surface-container-low overflow-hidden flex items-center justify-center">
        {mapStage < 2 ? (
          <img
            src={mapUrls[mapStage]}
            alt="Map"
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setMapStage(s => s + 1)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-outline">
            <span className="material-symbols-outlined text-[36px] text-red-400">location_on</span>
            <span className="text-[11px]">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
          </div>
        )}
      </div>
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-red-500">location_on</span>
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-semibold ${isOwn ? "text-on-primary" : "text-on-surface"}`}>Manzil</p>
          <p className={`text-[11px] truncate ${isOwn ? "text-on-primary/70" : "text-outline"}`}>
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </p>
        </div>
      </div>
    </a>
  );
}

// =====================================================================
// AUDIO BUBBLE — butun bubble click bilan play
// =====================================================================
function AudioBubble({ mxcUrl, isOwn, duration }: { mxcUrl?: string; isOwn: boolean; duration?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration ? duration / 1000 : 0);
  const [cur, setCur] = useState(0);
  const bars = useRef(Array.from({ length: 28 }, () => 0.15 + Math.random() * 0.85));

  useEffect(() => {
    if (!mxcUrl) { setLoading(false); return; }
    let cancelled = false;
    fetchMediaBlob(mxcUrl).then(url => {
      if (cancelled) return;
      if (url) setBlobUrl(url);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [mxcUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) clearActiveAudio(audio);
    };
  }, []);

  function toggle(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!audioRef.current || !blobUrl) return;
    if (playing) {
      audioRef.current.pause();
      setActiveAudio(null);
    } else {
      setActiveAudio(audioRef.current);
      audioRef.current.play().catch(err => console.warn("Audio play xato:", err));
    }
  }

  function fmt(s: number) {
    if (!s || isNaN(s) || !isFinite(s)) return "0:00";
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  }

  return (
    <div
      onClick={toggle}
      className={`flex items-center gap-2 px-2 py-2 rounded-[20px] min-w-[200px] max-w-[280px] cursor-pointer select-none ${isOwn ? "bg-primary-container rounded-br-[4px]" : "bg-surface-variant rounded-bl-[4px]"}`}
    >
      {blobUrl && (
        <audio
          ref={audioRef}
          src={blobUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={() => {
            if (!duration && audioRef.current && isFinite(audioRef.current.duration)) {
              setAudioDuration(audioRef.current.duration);
            }
          }}
          onTimeUpdate={() => {
            if (!audioRef.current) return;
            setCur(audioRef.current.currentTime);
            const d = audioRef.current.duration;
            if (d && isFinite(d)) setProgress(audioRef.current.currentTime / d);
          }}
          onEnded={() => { setPlaying(false); setProgress(0); setCur(0); }}
        />
      )}
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isOwn ? "bg-white/20 text-on-primary" : "bg-primary-container/30 text-primary"}`}
      >
        {loading ? (
          <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
        ) : (
          <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            {playing ? "pause" : "play_arrow"}
          </span>
        )}
      </div>
      <div className="flex-1 flex flex-col gap-1 min-w-0 pointer-events-none">
        <div className="flex items-end gap-[1.5px] h-[22px]">
          {bars.current.map((h, i) => {
            const filled = playing && progress > 0 && i / bars.current.length < progress;
            return <div key={i} className="flex-1 rounded-full transition-all duration-75"
              style={{
                height: `${h * 22}px`,
                backgroundColor: isOwn
                  ? (filled ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)")
                  : (filled ? "#34C759" : "rgba(0,0,0,0.12)"),
                minWidth: "2px",
              }} />;
          })}
        </div>
        <span className={`text-[10px] ${isOwn ? "text-on-primary/60" : "text-outline"}`}>
          {playing ? fmt(cur) : fmt(audioDuration)}
        </span>
      </div>
    </div>
  );
}

// =====================================================================
// FILE BUBBLE
// =====================================================================
function FileBubble({ mxcUrl, fileName, fileSize, isOwn }: { mxcUrl?: string; fileName?: string; fileSize?: number; isOwn: boolean }) {
  const [downloading, setDownloading] = useState(false);

  async function handleOpen() {
    if (!mxcUrl || downloading) return;
    setDownloading(true);
    try {
      const blobUrl = await fetchMediaBlob(mxcUrl);
      if (blobUrl) {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.target = "_blank";
        a.rel = "noreferrer";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 100);
      }
    } catch (e) { console.error(e); }
    finally { setDownloading(false); }
  }

  return (
    <button onClick={handleOpen} disabled={downloading}
      className={`flex items-center gap-2 px-3 py-2 rounded-2xl ${isOwn ? "bg-primary-container" : "bg-surface-variant"}`}>
      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-[20px] text-white">
          {downloading ? "progress_activity" : "description"}
        </span>
      </div>
      <div className="min-w-0 text-left">
        <p className={`text-[13px] font-medium truncate ${isOwn ? "text-on-primary" : "text-on-surface"}`}>{fileName}</p>
        <p className={`text-[11px] ${isOwn ? "text-on-primary/70" : "text-outline"}`}>{fmtSize(fileSize || 0)}</p>
      </div>
    </button>
  );
}

// =====================================================================
// IMAGE LIGHTBOX MODAL
// =====================================================================
function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/85 z-[200] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white">
        <span className="material-symbols-outlined">close</span>
      </button>
      <a href={url} download className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white" onClick={e => e.stopPropagation()}>
        <span className="material-symbols-outlined">download</span>
      </a>
      <img src={url} alt="" className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
    </div>
  );
}

// =====================================================================
// MAIN CHAT WINDOW
// =====================================================================
export default function ChatWindow({ roomId, roomName, onBack, onVideoCall }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [otherUserOnline, setOtherUserOnline] = useState(false);
  const [otherUserLastSeen, setOtherUserLastSeen] = useState<Date | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [contextMenu, setContextMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [deleteModal, setDeleteModal] = useState<Message | null>(null);
  const [savedDraft, setSavedDraft] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const activeStreamRef   = useRef<MediaStream | null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);
  const recordTimerRef    = useRef<any>(null);
  const waveIntervalRef   = useRef<any>(null);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const recordStartRef    = useRef<number>(0);
  const typingTimerRef    = useRef<any>(null);
  const recWaveRef        = useRef<number[]>(Array.from({ length: 30 }, () => 0.1));
  const [liveWave, setLiveWave] = useState<number[]>(Array.from({ length: 30 }, () => 0.1));

  // Scroll tracking
  const atBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Long press for message context menu
  const msgPressTimer = useRef<any>(null);
  const msgPressPos = useRef<{ msg: Message; x: number; y: number; startX: number; startY: number } | null>(null);

  // Voice recording: hold-to-record uchun
  const micPressTimer = useRef<any>(null);
  const isHoldRecording = useRef(false);

  // Read receipt — other user's latest read event
  const [otherReadEventId, setOtherReadEventId] = useState<string | null>(null);
  const [otherReadIdx, setOtherReadIdx] = useState(-1);

  const myUserId = typeof window !== "undefined" ? localStorage.getItem("mx_user_id") : null;

  // Unmount cleanup — timerlar va media
  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current);
      clearInterval(recordTimerRef.current);
      clearInterval(waveIntervalRef.current);
      audioCtxRef.current?.close().catch(() => {});
      // Mic stream to'xtatish
      activeStreamRef.current?.getTracks().forEach(t => t.stop());
      activeStreamRef.current = null;
      if (mediaRecorderRef.current?.state !== "inactive") {
        try { mediaRecorderRef.current?.stop(); } catch {}
      }
    };
  }, []);

  const parseEvent = useCallback((e: any): Message | null => {
    if (!e) return null;
    const type = e.getType?.();
    if (!type) return null;
    const content = e.getContent?.() || {};

    if (type === "m.room.redaction") return null;

    if (e.isRedacted?.()) {
      return {
        id: e.getId() || "", sender: e.getSender() || "", senderName: "",
        body: "", timestamp: e.getDate() || new Date(),
        isOwn: e.getSender() === myUserId, type: "deleted",
      };
    }

    // Video call eventlari
    if (type === "m.call.invite" || type === "m.call.hangup") {
      const senderName = e.getSender()?.split(":")[0].slice(1) || "";
      return {
        id: e.getId() || "", sender: e.getSender() || "", senderName,
        body: type === "m.call.invite" ? "📹 Video qo'ng'iroq" : "Qo'ng'iroq tugadi",
        timestamp: e.getDate() || new Date(),
        isOwn: e.getSender() === myUserId, type: "call",
      };
    }

    if (type !== "m.room.message") return null;

    const relatesTo = content["m.relates_to"];
    if (relatesTo?.rel_type === "m.replace") return null;

    const msgtype = content.msgtype;
    const senderName = e.getSender()?.split(":")[0].slice(1) || "";

    let replyToData: Message["replyTo"];
    const inReplyToId = relatesTo?.["m.in_reply_to"]?.event_id;
    if (inReplyToId) {
      const client = getMatrixClient();
      const room = client?.getRoom(roomId);
      const origEvent = room?.getLiveTimeline().getEvents().find((ev: any) => ev.getId() === inReplyToId);
      if (origEvent) {
        const origContent = origEvent.getContent();
        replyToData = {
          sender: origEvent.getSender()?.split(":")[0].slice(1) || "",
          body: origContent.msgtype === "m.audio" ? "🎤 Ovozli xabar" : (origContent.body || ""),
          id: origEvent.getId() || "",
        };
      }
    }

    let finalBody = content.body || "";
    let edited = false;
    const client = getMatrixClient();
    const room = client?.getRoom(roomId);
    if (room) {
      const edits = room.getLiveTimeline().getEvents().filter((ev: any) => {
        const c = ev.getContent();
        return c["m.relates_to"]?.rel_type === "m.replace" && c["m.relates_to"]?.event_id === e.getId();
      });
      if (edits.length > 0) {
        finalBody = edits[edits.length - 1].getContent()["m.new_content"]?.body || finalBody;
        edited = true;
      }
    }

    // Yangi m.location msgtype
    if (msgtype === "m.location") {
      const geoUri = content.geo_uri || content["org.matrix.msc3488.location"]?.uri || "";
      const match = geoUri.match(/geo:([-\d.]+),([-\d.]+)/);
      return {
        id: e.getId() || "", sender: e.getSender() || "", senderName,
        body: finalBody, timestamp: e.getDate() || new Date(),
        isOwn: e.getSender() === myUserId, type: "location",
        geoLat: match ? parseFloat(match[1]) : undefined,
        geoLng: match ? parseFloat(match[2]) : undefined,
        replyTo: replyToData, edited,
      };
    }

    // Eski location format (text + maps.google.com)
    if (msgtype === "m.text" && finalBody?.includes?.("maps.google.com")) {
      const match = finalBody.match(/q=([-\d.]+),([-\d.]+)/);
      return {
        id: e.getId() || "", sender: e.getSender() || "", senderName,
        body: finalBody, timestamp: e.getDate() || new Date(),
        isOwn: e.getSender() === myUserId, type: "location",
        geoLat: match ? parseFloat(match[1]) : undefined,
        geoLng: match ? parseFloat(match[2]) : undefined,
        replyTo: replyToData, edited,
      };
    }

    return {
      id: e.getId() || "", sender: e.getSender() || "", senderName,
      body: finalBody, timestamp: e.getDate() || new Date(),
      isOwn: e.getSender() === myUserId,
      type: msgtype === "m.audio" ? "audio"
        : msgtype === "m.image" ? "image"
        : msgtype === "m.file" ? "file" : "text",
      mxcUrl: content.url,
      fileName: content.body, fileSize: content.info?.size,
      duration: content.info?.duration,
      width: content.info?.w, height: content.info?.h,
      replyTo: replyToData, edited,
    };
  }, [roomId, myUserId]);

  // Boshqa userning online statusini olish
  useEffect(() => {
    const client = getMatrixClient();
    if (!client) return;
    const cl = client;

    function updateOtherStatus() {
      const room = cl.getRoom(roomId);
      if (!room) return;
      const others = room.getJoinedMembers().filter((m: any) => m.userId !== myUserId);
      if (others.length === 0) return;
      const otherUser = cl.getUser(others[0].userId);
      if (otherUser) {
        setOtherUserOnline(otherUser.presence === "online");
        if (otherUser.lastPresenceTs) {
          setOtherUserLastSeen(new Date(otherUser.lastPresenceTs));
        }
      }
    }

    updateOtherStatus();
    cl.on("User.presence" as any, updateOtherStatus);
    return () => { cl.off("User.presence" as any, updateOtherStatus); };
  }, [roomId, myUserId]);

  // Xabarlarni yuklash + real-time
  useEffect(() => {
    const client = getMatrixClient();
    if (!client) return;

    const room = client.getRoom(roomId);
    if (room) {
      const msgs = room.getLiveTimeline().getEvents()
        .map(ev => parseEvent(ev)).filter(Boolean) as Message[];
      setMessages(msgs);
      // Xonaga kirganda darhol o'qildi deb belgilash
      markRoomAsRead(roomId);
    }

    const onTimeline = (event: any, evRoom: any) => {
      if (evRoom?.roomId !== roomId) return;

      const eventType = event.getType?.();
      const content = event.getContent?.() || {};

      if (eventType === "m.room.message" && content["m.relates_to"]?.rel_type === "m.replace") {
        const targetId = content["m.relates_to"].event_id;
        const newBody = content["m.new_content"]?.body || "";
        setMessages(prev => prev.map(m =>
          m.id === targetId ? { ...m, body: newBody, edited: true } : m
        ));
        return;
      }

      if (eventType === "m.room.redaction") {
        const targetId = event.getAssociatedId?.() || (event as any).event?.redacts;
        if (targetId) {
          setMessages(prev => prev.map(m =>
            m.id === targetId ? { ...m, type: "deleted" as const, body: "" } : m
          ));
        }
        return;
      }

      const msg = parseEvent(event);
      if (!msg) return;

      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);

      // Yangi xabar kelganda o'qildi deb belgilaymiz (chatda turibmiz)
      if (!msg.isOwn) {
        if (document.hidden) {
          showNotification(msg.senderName, msg.body || "Yangi xabar");
        } else {
          markRoomAsRead(roomId);
        }
      }
    };

    // Typing indicator
    const onRoomEvent = (event: any) => {
      if (event.getType() !== "m.typing") return;
      if (event.getRoomId && event.getRoomId() !== roomId) return;
      const r = client.getRoom(roomId);
      if (!r) return;
      const typingIds: string[] = (event.getContent?.()?.user_ids) || [];
      setTypingUsers(typingIds.filter(u => u !== myUserId).map(u => u.split(":")[0].slice(1)));
    };

    // RoomMember.typing fallback (eski API)
    const onTyping = (event: any, member: any) => {
      const r = client.getRoom(roomId);
      if (!r) return;
      const allMembers = r.getJoinedMembers() as any[];
      const typing = allMembers
        .filter((m: any) => m.typing && m.userId !== myUserId)
        .map((m: any) => m.userId.split(":")[0].slice(1));
      setTypingUsers(typing);
    };

    // Read receipt tracker
    const cl2 = client;
    function updateReadReceipt() {
      const r = cl2.getRoom(roomId);
      if (!r) return;
      const others = r.getJoinedMembers().filter((m: any) => m.userId !== myUserId);
      if (others.length === 0) return;
      const eventId = (r as any).getEventReadUpTo?.(others[0].userId) ?? null;
      setOtherReadEventId(eventId);
    }
    updateReadReceipt();

    client.on("Room.timeline" as any, onTimeline);
    client.on("Room.accountData" as any, onRoomEvent);
    client.on("RoomMember.typing" as any, onTyping);
    client.on("event" as any, onRoomEvent);
    client.on("Room.receipt" as any, updateReadReceipt);

    return () => {
      client.off("Room.timeline" as any, onTimeline);
      client.off("Room.accountData" as any, onRoomEvent);
      client.off("RoomMember.typing" as any, onTyping);
      client.off("event" as any, onRoomEvent);
      client.off("Room.receipt" as any, updateReadReceipt);
    };
  }, [roomId, myUserId, parseEvent]);

  // otherReadIdx — messages yoki otherReadEventId o'zgarganda yangilanadi
  useEffect(() => {
    if (!otherReadEventId) { setOtherReadIdx(-1); return; }
    const idx = messages.findIndex(m => m.id === otherReadEventId);
    setOtherReadIdx(idx);
  }, [otherReadEventId, messages]);

  // Smart scroll — faqat pastda bo'lsak yoki birinchi yuklanishda
  const isFirstLoad = useRef(true);
  useEffect(() => {
    if (isFirstLoad.current && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      isFirstLoad.current = false;
      return;
    }
    if (atBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Scroll tracker
  function handleContainerScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist < 80;
    setShowScrollDown(dist > 200);
  }

  // Long press handlers for message bubbles
  function handleMsgPressStart(e: React.TouchEvent, msg: Message) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const touch = e.touches[0];
    msgPressPos.current = {
      msg, x: rect.left, y: rect.top,
      startX: touch?.clientX || 0, startY: touch?.clientY || 0,
    };
    msgPressTimer.current = setTimeout(() => {
      if (msgPressPos.current) {
        const { msg: m, x, y } = msgPressPos.current;
        setContextMenu({ msg: m, x, y: y - 10 });
        if ((navigator as any).vibrate) (navigator as any).vibrate(50);
      }
    }, 350);
  }

  function handleMsgPressMove(e: React.TouchEvent) {
    // Faqat sezilarli harakatda (10px+) long-press'ni bekor qilish
    if (!msgPressPos.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - msgPressPos.current.startX);
    const dy = Math.abs(t.clientY - msgPressPos.current.startY);
    if (dx > 10 || dy > 10) {
      clearTimeout(msgPressTimer.current);
      msgPressPos.current = null;
    }
  }

  function handleMsgPressEnd() {
    clearTimeout(msgPressTimer.current);
    msgPressPos.current = null;
  }

  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    sendTyping(roomId, text.length > 0);
    clearTimeout(typingTimerRef.current);
    if (text.length > 0) typingTimerRef.current = setTimeout(() => sendTyping(roomId, false), 3000);
  }, [roomId]);

  async function handleSend() {
    if (!inputText.trim() || sending) return;
    setSending(true);
    try {
      if (editingMsg) {
        await editMessage(roomId, editingMsg.id, inputText.trim());
        setEditingMsg(null); setInputText(savedDraft); setSavedDraft("");
      } else if (replyTo) {
        await sendReply(roomId, inputText.trim(), replyTo.id);
        setReplyTo(null); setInputText("");
      } else {
        await sendMessage(roomId, inputText.trim());
        setInputText("");
      }
      sendTyping(roomId, false);
    } catch (err) {
      console.error("Yuborish xato:", err); alert("Xabar yuborilmadi");
    } finally { setSending(false); }
  }

  async function confirmDelete() {
    if (!deleteModal) return;
    try {
      await deleteMessage(roomId, deleteModal.id);
      setMessages(prev => prev.map(m =>
        m.id === deleteModal.id ? { ...m, type: "deleted" as const, body: "" } : m
      ));
    } catch (err) { console.error(err); }
    setDeleteModal(null);
  }

  function handleReply(msg: Message) {
    if (!replyTo && !editingMsg) setSavedDraft(inputText);
    setReplyTo(msg); setEditingMsg(null); setContextMenu(null);
  }
  function handleEdit(msg: Message) {
    if (!replyTo && !editingMsg) setSavedDraft(inputText);
    setEditingMsg(msg); setReplyTo(null); setInputText(msg.body); setContextMenu(null);
  }
  function cancelReplyEdit() {
    setReplyTo(null); setEditingMsg(null); setInputText(savedDraft); setSavedDraft("");
  }
  function openContextMenu(e: React.MouseEvent | React.TouchEvent, msg: Message) {
    e.preventDefault(); e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ msg, x: rect.left, y: rect.top - 10 });
  }

  async function handleAttach(action: string) {
    setShowAttach(false);
    if (action === "image" || action === "file" || action === "camera") {
      const input = document.createElement("input");
      input.type = "file";

      if (action === "image") {
        // Faqat galereyadan rasmlar — kameraga kirmasligi uchun capture'ni qo'ymaslik
        input.setAttribute("accept", "image/*");
        input.removeAttribute("capture");
      } else if (action === "camera") {
        // Kamera — capture attribut majburiy attribute sifatida qo'yiladi
        input.setAttribute("accept", "image/*,video/*");
        input.setAttribute("capture", "environment");
      } else {
        // Hujjat — kameraga aloqasi yo'q
        input.setAttribute("accept", "*/*");
        input.removeAttribute("capture");
      }

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        try {
          if (file.type.startsWith("image/")) await sendImage(roomId, file);
          else await sendFile(roomId, file);
        } catch (err) { console.error(err); alert("Fayl yuborilmadi"); }
      };

      // Ba'zi mobil brauzerlar uchun DOM'ga qo'shib click qilish kerak
      input.style.display = "none";
      document.body.appendChild(input);
      input.click();
      setTimeout(() => { try { document.body.removeChild(input); } catch {} }, 60000);

    } else if (action === "location") {
      if (!navigator.geolocation) {
        alert("Bu brauzer joylashuvni qo'llab-quvvatlamaydi");
        return;
      }

      // 2 bosqichli strategiya: avval keshlangan past aniqlik (tez), keyin yuqori aniqlik
      let sent = false;

      const sendOnce = async (pos: GeolocationPosition) => {
        if (sent) return;
        sent = true;
        try {
          await sendLocation(roomId, pos.coords.latitude, pos.coords.longitude);
        } catch (e) {
          console.error("sendLocation xato:", e);
          alert("Manzil yuborilmadi");
        }
      };

      const onErr = (err: GeolocationPositionError) => {
        if (sent) return;
        if (err.code === 1)      alert("Joylashuv ruxsati rad etildi.\nBrauzer sozlamalaridan ruxsat bering.");
        else if (err.code === 2) alert("Joylashuv aniqlanmadi (GPS signal yo'q).\nTashqariga chiqib qayta urining.");
        else if (err.code === 3) alert("Joylashuv aniqlanishi vaqti tugadi. Qayta urining.");
        else                     alert("Joylashuv xatosi: " + (err.message || "noma'lum"));
      };

      // 1-bosqich: keshdan tezda olishga harakat (instant)
      navigator.geolocation.getCurrentPosition(
        sendOnce,
        () => {
          // Cache'da yo'q — 2-bosqich: yangi GPS o'qish, 30s timeout
          navigator.geolocation.getCurrentPosition(sendOnce, onErr, {
            timeout: 30000,
            enableHighAccuracy: false,
            maximumAge: 0,
          });
        },
        {
          timeout: 5000,
          enableHighAccuracy: false,
          maximumAge: 300000,  // 5 daqiqa kesh
        }
      );
    }
  }

  async function startRecording() {
    if (recording) { stopRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStreamRef.current = stream;

      let mimeType = "audio/webm";
      if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus"))    mimeType = "audio/ogg;codecs=opus";
      else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
      else if (MediaRecorder.isTypeSupported("audio/mp4"))            mimeType = "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current   = [];
      recordStartRef.current   = Date.now();

      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        // Mic track'larini to'xtatish
        stream.getTracks().forEach(t => t.stop());
        activeStreamRef.current = null;
        const duration = Date.now() - recordStartRef.current;
        const waveSnapshot = [...recWaveRef.current];
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size > 1000) {
          try { await sendVoiceMessage(roomId, blob, duration, waveSnapshot); }
          catch (err) { console.error(err); }
        }
      };

      recorder.start();
      setRecording(true);
      setRecordSeconds(0);

      // ── Real-time waveform via AnalyserNode ──
      try {
        const ctx      = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;                // 64 frequency bins
        analyser.smoothingTimeConstant = 0.6;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current  = ctx;
        analyserRef.current  = analyser;
      } catch { /* eski brauzerlar uchun fallback */ }

      // Timer + waveform yangilanishi (5fps)
      recordTimerRef.current  = setInterval(() => setRecordSeconds(p => p + 1), 1000);
      waveIntervalRef.current = setInterval(() => {
        if (analyserRef.current) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const bars = Array.from({ length: 30 }, (_, i) => {
            const idx = Math.floor(i * data.length / 30);
            return Math.max(data[idx] / 255, 0.05);
          });
          recWaveRef.current = bars;
          setLiveWave([...bars]);
        } else {
          // Fallback — tasodifiy
          const bars = Array.from({ length: 30 }, () => 0.05 + Math.random() * 0.6);
          recWaveRef.current = bars;
          setLiveWave([...bars]);
        }
      }, 200);

    } catch (err) {
      console.error("Mikrofon xatosi:", err);
      alert("Mikrofon ruxsati kerak!");
    }
  }

  function stopRecording(cancel = false) {
    clearInterval(recordTimerRef.current);
    clearInterval(waveIntervalRef.current);
    setRecording(false);
    setRecordSeconds(0);
    setLiveWave(Array.from({ length: 30 }, () => 0.1));

    // AudioContext yopish
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current  = null;
    analyserRef.current  = null;

    if (cancel) {
      audioChunksRef.current = [];
      // Cancel bo'lsa stream'ni darhol to'xtatamiz
      activeStreamRef.current?.getTracks().forEach(t => t.stop());
      activeStreamRef.current = null;
    }
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop();
    }
  }

  // Header status
  let headerStatus = "Oflayn";
  if (typingUsers.length > 0) headerStatus = "yozmoqda...";
  else if (otherUserOnline) headerStatus = "Onlayn";
  else if (otherUserLastSeen) {
    const days = Math.floor((Date.now() - otherUserLastSeen.getTime()) / 86400000);
    if (days === 0) headerStatus = `oxirgi: ${otherUserLastSeen.toLocaleTimeString("uz", { hour: "2-digit", minute: "2-digit" })}`;
    else if (days < 7) headerStatus = `oxirgi: ${days} kun oldin`;
    else headerStatus = "uzoq vaqt oldin";
  }

  const attachItems = [
    { icon: "description", label: "Hujjat", color: "#FF9500", action: "file" },
    { icon: "photo_library", label: "Galereya", color: "#007AFF", action: "image" },
    { icon: "photo_camera", label: "Kamera", color: "#34C759", action: "camera" },
    { icon: "location_on", label: "Manzil", color: "#FF3B30", action: "location" },
  ];

  // Date separators uchun guruhlar
  let lastDateLabel = "";

  return (
    <div className="flex flex-col h-full bg-background relative" onClick={() => setContextMenu(null)}>
      <header className="bg-white/80 backdrop-blur-2xl border-b border-gray-200/30 h-[56px] md:h-[64px] px-3 flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="text-primary p-1 rounded-full flex-shrink-0">
            <span className="material-symbols-outlined text-[24px]">chevron_left</span>
          </button>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0"
            style={{ backgroundColor: getColor(roomName) }}>
            {roomName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[14px] text-on-surface truncate">{roomName}</p>
            {typingUsers.length > 0
              ? <p className="text-[11px] text-primary animate-pulse">yozmoqda...</p>
              : <p className={`text-[11px] ${otherUserOnline ? "text-green-600" : "text-outline"}`}>{headerStatus}</p>}
          </div>
        </div>
        <button onClick={onVideoCall} className="p-2 rounded-full hover:bg-surface-variant/50 text-primary flex-shrink-0">
          <span className="material-symbols-outlined text-[22px]">videocam</span>
        </button>
      </header>

      <main
        ref={messagesContainerRef}
        onScroll={handleContainerScroll}
        data-scrollable
        className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center flex-1 text-outline text-sm">Hali xabar yo'q</div>
        )}

        {messages.map((msg, msgIdx) => {
          // Date separator
          const dateLabel = getDateLabel(msg.timestamp);
          const showDateSep = dateLabel !== lastDateLabel;
          if (showDateSep) lastDateLabel = dateLabel;

          if (msg.type === "call") return (
            <div key={msg.id} id={msg.id}>
              {showDateSep && <DateSeparator label={dateLabel} />}
              <div className="flex justify-center my-1.5">
                <span className="text-[11px] text-outline bg-surface-container px-3 py-1 rounded-full flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">videocam</span>
                  {msg.isOwn ? "Siz qo'ng'iroq qildingiz" : `${msg.senderName} qo'ng'iroq qildi`}
                  <span className="ml-1 text-outline/60">{formatMessageTime(msg.timestamp)}</span>
                </span>
              </div>
            </div>
          );

          if (msg.type === "deleted") return (
            <div key={msg.id} id={msg.id}>
              {showDateSep && <DateSeparator label={dateLabel} />}
              <div className={`flex ${msg.isOwn ? "justify-end" : "justify-start"} my-0.5`}>
                <span className="text-[12px] text-outline italic px-3 py-1.5 bg-surface-container/50 rounded-xl flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">block</span>Xabar o'chirildi
                </span>
              </div>
            </div>
          );

          return (
            <div key={msg.id} id={msg.id}>
              {showDateSep && <DateSeparator label={dateLabel} />}
              <div className={`flex items-end gap-1.5 ${msg.isOwn ? "justify-end" : "justify-start"}`}>
                {!msg.isOwn && (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 mb-4 text-white"
                    style={{ backgroundColor: getColor(msg.sender) }}>
                    {msg.sender.slice(1, 3).toUpperCase()}
                  </div>
                )}
                <div className={`flex flex-col ${msg.isOwn ? "items-end" : "items-start"} max-w-[80%] md:max-w-[65%] cursor-pointer no-select`}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setContextMenu({ msg, x: r.left, y: r.top - 10 }); }}
                  onTouchStart={(e) => handleMsgPressStart(e, msg)}
                  onTouchEnd={handleMsgPressEnd}
                  onTouchCancel={handleMsgPressEnd}
                  onTouchMove={handleMsgPressMove}>
                  {msg.replyTo && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        document.getElementById(msg.replyTo!.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className={`text-[11px] mb-0.5 px-2 py-1 rounded-lg max-w-full cursor-pointer ${msg.isOwn ? "bg-primary-container/30" : "bg-surface-variant/50"}`}>
                      <p className="font-semibold text-primary">{msg.replyTo.sender}</p>
                      <p className="text-on-surface-variant truncate">{msg.replyTo.body}</p>
                    </div>
                  )}

                  {msg.type === "audio" ? (
                    <AudioBubble mxcUrl={msg.mxcUrl} isOwn={msg.isOwn} duration={msg.duration} />
                  ) : msg.type === "image" ? (
                    <MediaImage mxcUrl={msg.mxcUrl} fileName={msg.fileName} onOpen={setLightboxUrl} />
                  ) : msg.type === "file" ? (
                    <FileBubble mxcUrl={msg.mxcUrl} fileName={msg.fileName} fileSize={msg.fileSize} isOwn={msg.isOwn} />
                  ) : msg.type === "location" && msg.geoLat && msg.geoLng ? (
                    <LocationBubble lat={msg.geoLat} lng={msg.geoLng} isOwn={msg.isOwn} />
                  ) : (
                    <div className={`px-3 py-1.5 rounded-2xl ${msg.isOwn ? "bg-primary-container text-on-primary rounded-br-[6px]" : "bg-surface-variant text-on-surface rounded-bl-[6px]"}`}>
                      <p className="text-[14px] whitespace-pre-wrap break-words">{msg.body}</p>
                    </div>
                  )}

                  <span className="text-[10px] text-outline mt-0.5 px-1 flex items-center gap-0.5">
                    {formatMessageTime(msg.timestamp)}
                    {msg.edited && <span className="italic">(tahrir)</span>}
                    {msg.isOwn && (
                      <span
                        className="material-symbols-outlined text-[13px]"
                        style={{
                          fontVariationSettings: "'FILL' 1",
                          color: otherReadIdx !== -1 && msgIdx <= otherReadIdx ? "#34C759" : "rgba(0,0,0,0.3)",
                        }}
                      >
                        {otherReadIdx !== -1 && msgIdx <= otherReadIdx ? "done_all" : "done"}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {typingUsers.length > 0 && (
          <div className="flex items-center gap-1.5 pl-8 py-1">
            <div className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-outline/50 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Scroll to bottom button */}
      {showScrollDown && (
        <button
          onClick={() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            atBottomRef.current = true;
            setShowScrollDown(false);
          }}
          className="absolute bottom-[72px] right-3 z-50 w-9 h-9 rounded-full bg-white shadow-md border border-gray-200/50 flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-[22px] text-primary">expand_more</span>
        </button>
      )}

      {/* Lightbox */}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-[80] bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden py-1 w-44"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.max(contextMenu.y - 180, 10) }}
          onClick={e => e.stopPropagation()}>
          <button onClick={() => handleReply(contextMenu.msg)}
            className="w-full px-4 py-2.5 text-left text-[13px] hover:bg-surface-container flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">reply</span>Javob berish
          </button>
          {contextMenu.msg.isOwn && contextMenu.msg.type === "text" && (
            <button onClick={() => handleEdit(contextMenu.msg)}
              className="w-full px-4 py-2.5 text-left text-[13px] hover:bg-surface-container flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">edit</span>Tahrirlash
            </button>
          )}
          {contextMenu.msg.isOwn && (
            <button onClick={() => { setDeleteModal(contextMenu.msg); setContextMenu(null); }}
              className="w-full px-4 py-2.5 text-left text-[13px] text-error hover:bg-surface-container flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">delete</span>O'chirish
            </button>
          )}
          <button onClick={() => { navigator.clipboard.writeText(contextMenu.msg.body); setContextMenu(null); }}
            className="w-full px-4 py-2.5 text-left text-[13px] hover:bg-surface-container flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">content_copy</span>Nusxalash
          </button>
        </div>
      )}

      {/* Delete modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center backdrop-blur-sm p-4" onClick={() => setDeleteModal(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center mb-3">
              <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px] text-error">delete</span>
              </div>
            </div>
            <h2 className="text-[17px] font-bold text-on-surface text-center mb-1">Xabarni o'chirish?</h2>
            <p className="text-[13px] text-outline text-center mb-5">Bu amal qaytarib bo'lmaydi</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)} className="flex-1 py-3 rounded-xl border border-outline-variant/30 text-[14px] font-medium text-on-surface">Bekor qilish</button>
              <button onClick={confirmDelete} className="flex-1 py-3 rounded-xl bg-error text-white text-[14px] font-semibold">O'chirish</button>
            </div>
          </div>
        </div>
      )}

      {/* Attach menu — backdrop muammosini hal qilish:
          fixed va background to'liq screenni qoplaydi (top + body) */}
      {showAttach && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60] backdrop-blur-[2px]" onClick={() => setShowAttach(false)} />
          <div className="absolute bottom-[60px] left-2 z-[70] w-[190px]">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-3">
              <div className="grid grid-cols-2 gap-2">
                {attachItems.map(item => (
                  <button key={item.label} onClick={() => handleAttach(item.action)}
                    className="flex flex-col items-center gap-1 active:scale-95 transition-transform p-2 rounded-xl hover:bg-surface-container-low">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: item.color }}>
                      <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>{item.icon}</span>
                    </div>
                    <span className="text-[11px] text-on-surface font-medium">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Reply/Edit preview */}
      {(replyTo || editingMsg) && (
        <div className="bg-surface-container/80 backdrop-blur-xl border-t border-gray-200/30 px-3 py-2 flex items-center gap-2 flex-shrink-0">
          <span className="material-symbols-outlined text-[18px] text-primary flex-shrink-0">{editingMsg ? "edit" : "reply"}</span>
          <div className="flex-1 border-l-2 border-primary pl-2 min-w-0">
            <p className="text-[11px] text-primary font-semibold">{editingMsg ? "Tahrirlash" : `Javob: ${replyTo?.senderName}`}</p>
            <p className="text-[12px] text-on-surface-variant truncate">{editingMsg?.body || replyTo?.body}</p>
          </div>
          <button onClick={cancelReplyEdit} className="p-1.5 text-outline flex-shrink-0 rounded-full hover:bg-surface-variant/50">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="bg-white/80 backdrop-blur-3xl border-t border-gray-200/30 flex-shrink-0 safe-bottom">
        {recording ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => stopRecording(true)} className="p-1.5 text-error rounded-full flex-shrink-0">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
            <div className="flex-1 bg-error/8 rounded-2xl px-3 py-2 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-error animate-pulse flex-shrink-0" />
              <span className="text-error text-[13px] font-medium tabular-nums w-10">
                {Math.floor(recordSeconds / 60)}:{(recordSeconds % 60).toString().padStart(2, "0")}
              </span>
              <div className="flex-1 flex items-end gap-[1.5px] h-[22px]">
                {liveWave.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-full transition-all duration-150"
                    style={{
                      height: `${Math.max(h * 22, 2)}px`,
                      minWidth: "1.5px",
                      backgroundColor: h > 0.5 ? "rgb(220,38,38)" : h > 0.25 ? "rgba(220,38,38,0.7)" : "rgba(220,38,38,0.35)",
                    }}
                  />
                ))}
              </div>
            </div>
            <button onClick={() => stopRecording(false)} className="bg-primary-container text-on-primary rounded-full w-9 h-9 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5 px-2 py-2">
            <button
              onClick={() => setShowAttach(!showAttach)}
              className="text-outline rounded-full hover:bg-surface-variant/50 flex-shrink-0 w-11 h-11 flex items-center justify-center"
              aria-label="Biriktirish"
            >
              <span className="material-symbols-outlined text-[24px]">add</span>
            </button>
            <div className="flex-1 bg-surface-container-low border border-outline-variant/20 rounded-3xl flex items-end px-1 py-1 min-h-[44px] focus-within:border-primary-container/40 transition-all">
              <textarea
                value={inputText}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={editingMsg ? "Tahrirlash..." : replyTo ? `${replyTo.senderName} ga javob...` : "Xabar yozing..."}
                rows={1}
                className="w-full bg-transparent border-none outline-none focus:ring-0 px-2 py-2 text-[15px] text-on-surface placeholder:text-outline resize-none max-h-[100px] overflow-y-auto"
                style={{ minHeight: "36px" }}
              />
              {inputText.trim() && (
                <button onClick={handleSend} disabled={sending}
                  className="bg-primary-container text-on-primary rounded-full w-8 h-8 flex items-center justify-center m-1 flex-shrink-0 disabled:opacity-50"
                  aria-label="Yuborish"
                >
                  <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {editingMsg ? "check" : "arrow_upward"}
                  </span>
                </button>
              )}
            </div>
            {!inputText.trim() && (
              <button
                onClick={startRecording}
                onContextMenu={(e) => e.preventDefault()}
                className="rounded-full flex-shrink-0 w-11 h-11 flex items-center justify-center bg-primary-container/15 text-primary active:scale-95 transition-all"
                aria-label="Ovozli xabar"
              >
                <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
              </button>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes fade-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        :global(.animate-fade-in) { animation: fade-in 0.15s ease-out; }
      `}</style>
    </div>
  );
}

// Date separator component
function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center my-2">
      <span className="text-[11px] text-outline bg-surface-container/70 backdrop-blur-md px-3 py-1 rounded-full font-medium">
        {label}
      </span>
    </div>
  );
}
