"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { getMatrixClient, logoutMatrix } from "@/lib/matrix";
import { useRouter } from "next/navigation";
import type { Room } from "matrix-js-sdk";

interface Props {
  onSelectRoom: (roomId: string, roomName: string) => void;
  activeRoomId: string | null;
  isAdmin?: boolean;
}

interface ChatItem {
  id: string;
  name: string;
  lastMessage: string;
  lastTime: string;
  unreadCount: number;
  avatarInitials: string;
  avatarColor: string;
  isOnline: boolean;
  lastActivityTs: number;
}

const COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9"];
function getColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getLastMessagePreview(event: any): string {
  if (!event) return "Xabar yo'q";
  if (event.isRedacted?.()) return "Xabar o'chirildi";
  const type = event.getType?.();
  if (type === "m.call.invite") return "📹 Video qo'ng'iroq";
  if (type === "m.call.hangup") return "📹 Qo'ng'iroq tugadi";
  const c = event.getContent?.() || {};
  if (c.msgtype === "m.audio") return "🎤 Ovozli xabar";
  if (c.msgtype === "m.image") return "📷 Rasm";
  if (c.msgtype === "m.file") return `📎 ${c.body || "Fayl"}`;
  if (c.msgtype === "m.location") return "📍 Manzil";
  if (c.body?.includes?.("maps.google.com")) return "📍 Manzil";
  return c.body || "Xabar yo'q";
}

// Vaqt formati - sana bilan
function formatTime(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days === 0) return date.toLocaleTimeString("uz", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Kecha";
  if (days < 7) return ["Yak", "Du", "Se", "Cho", "Pa", "Ju", "Sha"][date.getDay()];
  if (date.getFullYear() === new Date().getFullYear()) {
    return date.toLocaleDateString("uz", { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString("uz", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function ChatList({ onSelectRoom, activeRoomId, isAdmin = false }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogout, setShowLogout] = useState(false);
  const [newChatModal, setNewChatModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [longPressId, setLongPressId] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const longPressTimer = useRef<any>(null);
  const loadRoomsTimer = useRef<any>(null);

  // Admin check — localStorage'dagi flag bilan birga isAdmin prop'i ham
  const [iAmAdmin, setIAmAdmin] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const adminFlag = localStorage.getItem("mx_is_admin") === "true";
    setIAmAdmin(adminFlag || isAdmin);
  }, [isAdmin]);

  const loadRooms = useCallback(() => {
    const client = getMatrixClient();
    if (!client) return;

    const rooms = client.getRooms();
    const items: ChatItem[] = rooms
      .filter((r: Room) => {
        const me = r.getMember(client.getUserId() || "");
        return me?.membership === "join";
      })
      .map((room: Room) => {
        const timeline = room.getLiveTimeline().getEvents();
        const lastEvent = [...timeline].reverse().find((e: any) =>
          ["m.room.message", "m.call.invite", "m.call.hangup"].includes(e.getType())
        );

        const name = room.name || room.roomId;
        const members = room.getJoinedMembers();
        const otherMember = members.find((m: any) => m.userId !== client.getUserId());

        let isOnline = false;
        if (otherMember) {
          try {
            const user = client.getUser(otherMember.userId);
            isOnline = user?.presence === "online";
          } catch {}
        }

        // Unread count: notification count + read receipt'dan keyingi xabarlar
        let unreadCount = room.getUnreadNotificationCount() || 0;

        // Agar bu xona ochiq bo'lsa - unread = 0
        if (room.roomId === (window as any).__activeRoomId) {
          unreadCount = 0;
        }

        const lastActivityTs = room.getLastActiveTimestamp() || lastEvent?.getDate()?.getTime() || 0;

        return {
          id: room.roomId,
          name,
          lastMessage: getLastMessagePreview(lastEvent),
          lastTime: lastEvent?.getDate() ? formatTime(lastEvent.getDate()!) : "",
          unreadCount,
          avatarInitials: name.slice(0, 2).toUpperCase(),
          avatarColor: getColor(name),
          isOnline,
          lastActivityTs,
        };
      })
      .sort((a, b) => b.lastActivityTs - a.lastActivityTs);

    setChats(items);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Active room ID'ni global'da saqlash (unread count uchun)
    (window as any).__activeRoomId = activeRoomId;
    loadRooms();
  }, [activeRoomId, loadRooms]);

  useEffect(() => {
    const client = getMatrixClient();
    if (!client) return;

    loadRooms();

    const debounced = () => {
      clearTimeout(loadRoomsTimer.current);
      loadRoomsTimer.current = setTimeout(loadRooms, 300);
    };

    client.on("Room.timeline" as any, debounced);
    client.on("RoomMember.membership" as any, debounced);
    client.on("User.presence" as any, debounced);
    client.on("Room.name" as any, debounced);
    client.on("Room" as any, debounced);
    client.on("Room.receipt" as any, debounced);

    return () => {
      clearTimeout(loadRoomsTimer.current);
      client.off("Room.timeline" as any, debounced);
      client.off("RoomMember.membership" as any, debounced);
      client.off("User.presence" as any, debounced);
      client.off("Room.name" as any, debounced);
      client.off("Room" as any, debounced);
      client.off("Room.receipt" as any, debounced);
    };
  }, [loadRooms]);

  async function confirmDelete() {
    if (!deleteModal) return;
    setDeleting(true);
    const client = getMatrixClient();
    if (!client) { setDeleting(false); return; }
    try {
      await client.leave(deleteModal.id);
      setChats(prev => prev.filter(c => c.id !== deleteModal.id));
      setDeleteModal(null);
      setLongPressId(null);
    } catch (err) { console.error(err); }
    finally { setDeleting(false); }
  }

  function handleLongPressStart(chat: ChatItem) {
    longPressTimer.current = setTimeout(() => setLongPressId(chat.id), 500);
  }
  function handleLongPressEnd() { clearTimeout(longPressTimer.current); }

  async function handleCreateChat() {
    if (!newUsername.trim()) return;
    setCreating(true);
    const client = getMatrixClient();
    if (!client) { setCreating(false); return; }

    const myUserId = client.getUserId();
    const serverName = myUserId?.split(":")[1] || process.env.NEXT_PUBLIC_HOMESERVER_NAME || "matrix.org";

    let userId = newUsername.trim();
    if (!userId.startsWith("@")) userId = "@" + userId;
    if (!userId.includes(":")) userId = userId + ":" + serverName;

    // Mavjud DM xonasini tekshirish — joined VA invited memberlarni ham hisobga olamiz
    // (getJoinedMembers() faqat joined'larni ko'rsatadi, shuning uchun invited user
    //  bo'lgan yangi xona ham "mavjud" sifatida aniqlanmay qolishi mumkin edi)
    const existingRooms = client.getRooms();
    const existing = existingRooms.find(r => {
      const me = r.getMember(myUserId || "");
      if (!me || (me.membership !== "join" && me.membership !== "invite")) return false;
      const activeMembers = r.getMembers().filter(m =>
        m.membership === "join" || m.membership === "invite"
      );
      return activeMembers.length === 2 && activeMembers.some(m => m.userId === userId);
    });

    if (existing) {
      setNewChatModal(false);
      setNewUsername("");
      setCreating(false);
      onSelectRoom(existing.roomId, existing.name);
      return;
    }

    try {
      const result = await client.createRoom({
        invite: [userId],
        is_direct: true,
        preset: "trusted_private_chat" as any,
      });
      setNewChatModal(false);
      setNewUsername("");
      // Yangi yaratilgan xonani darhol ochish
      if (result.room_id) {
        setTimeout(() => {
          const room = client.getRoom(result.room_id);
          if (room) onSelectRoom(result.room_id, room.name || newUsername);
        }, 500);
      }
    } catch (err: any) {
      alert("Foydalanuvchi topilmadi: " + userId);
    } finally {
      setCreating(false);
    }
  }

  const myInitials = typeof window !== "undefined"
    ? (localStorage.getItem("mx_user_id")?.slice(1, 3).toUpperCase() || "Me") : "Me";
  const myName = typeof window !== "undefined"
    ? (localStorage.getItem("mx_user_id")?.split(":")[0].slice(1) || "") : "";

  const filtered = chats.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.lastMessage.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-surface relative">
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50 flex justify-between items-center w-full px-4 h-14 md:h-16">
        <div className="relative">
          <button onClick={() => setShowLogout(!showLogout)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm relative"
            style={{ backgroundColor: getColor(myName) }}>
            {myInitials}
          </button>
          {showLogout && (
            <div className="absolute top-11 left-0 bg-white rounded-xl shadow-lg border border-gray-100 z-50 w-44 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100">
                <p className="text-[13px] font-medium text-on-surface">{myName}</p>
                {iAmAdmin && <p className="text-[10px] text-primary mt-0.5">Admin</p>}
              </div>
              <button onClick={() => { logoutMatrix(); router.push("/"); }}
                className="w-full px-4 py-2.5 text-left text-[14px] text-error hover:bg-surface-container flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">logout</span>Chiqish
              </button>
            </div>
          )}
        </div>
        <h1 className="text-lg font-bold text-gray-900 tracking-tight">Messages</h1>
        {iAmAdmin ? (
          <button onClick={() => setNewChatModal(true)} className="text-primary p-2 rounded-full hover:bg-surface-variant/50">
            <span className="material-symbols-outlined text-[22px]">edit_square</span>
          </button>
        ) : <div className="w-10" />}
      </header>

      <div className="px-3 pt-2.5 pb-1.5 sticky top-14 md:top-16 z-40 bg-surface/90 backdrop-blur-md">
        <div className="relative flex items-center w-full bg-surface-container-low rounded-xl border border-transparent focus-within:border-primary-container/40 transition-all">
          <span className="material-symbols-outlined text-outline ml-3 mr-1.5 text-[18px]">search</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-transparent border-none py-2 pr-3 text-[14px] text-on-surface placeholder:text-outline focus:outline-none focus:ring-0"
            placeholder="Qidirish..." type="text" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" data-scrollable>
        {loading ? (
          <div className="flex items-center justify-center h-32 text-outline text-sm">Yuklanmoqda...</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-outline text-sm">Suhbat topilmadi</div>
        ) : filtered.map(chat => (
          <article key={chat.id}
            onClick={() => {
              if (longPressId) { setLongPressId(null); return; }
              onSelectRoom(chat.id, chat.name);
            }}
            onMouseDown={() => handleLongPressStart(chat)}
            onMouseUp={handleLongPressEnd}
            onTouchStart={() => handleLongPressStart(chat)}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={(e) => { e.preventDefault(); setLongPressId(chat.id); }}
            className={`flex items-center px-3 md:px-4 py-2.5 cursor-pointer transition-colors relative ${
              activeRoomId === chat.id ? "bg-primary-container/10" : "hover:bg-surface-container-low"
            }`}>
            {longPressId === chat.id && (
              <div className="absolute right-3 top-1 bg-white rounded-xl shadow-lg border border-gray-100 z-50 overflow-hidden"
                onClick={e => e.stopPropagation()}>
                <button onClick={() => { setDeleteModal({ id: chat.id, name: chat.name }); setLongPressId(null); }}
                  className="px-4 py-2.5 text-[13px] text-error hover:bg-surface-container flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">delete</span>O'chirish
                </button>
              </div>
            )}
            <div className="relative mr-3 flex-shrink-0">
              <div className="w-[48px] h-[48px] rounded-full flex items-center justify-center text-white font-semibold text-[15px]"
                style={{ backgroundColor: chat.avatarColor }}>
                {chat.avatarInitials}
              </div>
              <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 border-[2.5px] border-surface rounded-full ${
                chat.isOnline ? "bg-green-500" : "bg-gray-400"
              }`} />
            </div>
            <div className="flex-1 flex flex-col justify-center py-1 min-w-0">
              <div className="flex justify-between items-baseline mb-0.5">
                <h2 className="font-semibold text-[15px] text-on-surface truncate">{chat.name}</h2>
                <span className={`text-[11px] flex-shrink-0 ml-2 ${chat.unreadCount > 0 ? "text-primary font-medium" : "text-outline"}`}>
                  {chat.lastTime}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[13px] text-on-surface-variant truncate pr-2">{chat.lastMessage}</p>
                {chat.unreadCount > 0 && (
                  <span className="bg-primary-container text-on-primary text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center flex-shrink-0">
                    {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Yangi chat modal — faqat admin */}
      {newChatModal && iAmAdmin && (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-end md:items-center justify-center backdrop-blur-sm"
          onClick={() => setNewChatModal(false)}>
          <div className="bg-white rounded-t-3xl md:rounded-3xl w-full max-w-md p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
            <h2 className="text-[18px] font-bold text-on-surface mb-4">Yangi chat</h2>
            <input value={newUsername} onChange={e => setNewUsername(e.target.value)}
              placeholder="username kiriting"
              className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-[15px] placeholder:text-outline border border-outline-variant/30 focus:outline-none focus:border-primary-container mb-4"
              onKeyDown={e => e.key === "Enter" && handleCreateChat()} autoFocus />
            <div className="flex gap-3">
              <button onClick={() => { setNewChatModal(false); setNewUsername(""); }}
                className="flex-1 py-3 rounded-xl border border-outline-variant/30 text-[15px] text-outline">Bekor qilish</button>
              <button onClick={handleCreateChat} disabled={creating || !newUsername.trim()}
                className="flex-1 py-3 rounded-xl bg-primary-container text-on-primary text-[15px] font-semibold disabled:opacity-50">
                {creating ? "..." : "Boshlash"}
              </button>
            </div>
          </div>
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
            <h2 className="text-[17px] font-bold text-on-surface text-center mb-1">Chatni o'chirish?</h2>
            <p className="text-[13px] text-outline text-center mb-5">
              <span className="font-semibold text-on-surface">{deleteModal.name}</span> bilan chat o'chiriladi
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)} disabled={deleting}
                className="flex-1 py-3 rounded-xl border border-outline-variant/30 text-[14px] font-medium text-on-surface">Bekor qilish</button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-3 rounded-xl bg-error text-white text-[14px] font-semibold disabled:opacity-50">
                {deleting ? "O'chirilmoqda..." : "O'chirish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogout && <div className="fixed inset-0 z-40" onClick={() => setShowLogout(false)} />}
      {longPressId && <div className="fixed inset-0 z-40" onClick={() => setLongPressId(null)} />}

      <style jsx>{`
        @keyframes slide-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fade-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        :global(.animate-slide-up) { animation: slide-up 0.2s ease-out; }
        :global(.animate-fade-in) { animation: fade-in 0.15s ease-out; }
      `}</style>
    </div>
  );
}
