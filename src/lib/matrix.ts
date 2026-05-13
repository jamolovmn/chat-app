"use client";
import * as sdk from "matrix-js-sdk";

// matrix-js-sdk warning spam ni filter qilish
if (typeof window !== "undefined") {
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    const s = String(args[0] || "");
    if (s.includes("Adding default global") || s.includes("push rule")) return;
    origWarn.apply(console, args);
  };
}

const MATRIX_URL = process.env.NEXT_PUBLIC_MATRIX_URL || "";

// =====================================================================
// SINGLETON CLIENT
// =====================================================================

let _client: sdk.MatrixClient | null = null;
let _syncReady = false;
let _startPromise: Promise<sdk.MatrixClient | null> | null = null;
const _syncListeners = new Set<() => void>();

function notifySyncReady() {
  _syncReady = true;
  _syncListeners.forEach(fn => { try { fn(); } catch {} });
}

export function waitForSync(): Promise<void> {
  return new Promise(resolve => {
    if (_syncReady) { resolve(); return; }
    const off = () => { _syncListeners.delete(off); resolve(); };
    _syncListeners.add(off);
  });
}

export function getMatrixClient(): sdk.MatrixClient | null {
  if (typeof window === "undefined") return null;
  if (_client) return _client;

  const accessToken = localStorage.getItem("mx_access_token");
  const userId = localStorage.getItem("mx_user_id");
  const deviceId = localStorage.getItem("mx_device_id");
  if (!accessToken || !userId) return null;

  _client = sdk.createClient({
    baseUrl: MATRIX_URL,
    accessToken, userId,
    deviceId: deviceId || undefined,
    fallbackICEServerAllowed: true,
    useAuthorizationHeader: true,
    timelineSupport: true,
  });
  return _client;
}

export function createAuthClient(): sdk.MatrixClient | null {
  return getMatrixClient();
}

export async function startMatrix(): Promise<sdk.MatrixClient | null> {
  if (_startPromise) return _startPromise;

  _startPromise = (async () => {
    const client = getMatrixClient();
    if (!client) return null;

    client.on("sync" as any, (state: string) => {
      if (state === "PREPARED" || state === "SYNCING") {
        if (!_syncReady) notifySyncReady();
      }
    });

    // Auto-join — invite kelganda darhol qabul qilish
    client.on("RoomMember.membership" as any, (_event: any, member: any) => {
      const myId = client.getUserId();
      if (member.membership === "invite" && member.userId === myId) {
        client.joinRoom(member.roomId).catch(e =>
          console.warn("Auto-join xato:", member.roomId, e?.message)
        );
      }
    });

    await client.startClient({ initialSyncLimit: 50 });

    setTimeout(() => {
      const rooms = client.getRooms();
      rooms.forEach(room => {
        const me = room.getMember(client.getUserId() || "");
        if (me?.membership === "invite") {
          client.joinRoom(room.roomId).catch(() => {});
        }
      });
    }, 1500);

    return client;
  })();

  return _startPromise;
}

export async function ensureClientStarted(): Promise<sdk.MatrixClient | null> {
  return startMatrix();
}

export function stopMatrix() {
  if (_client) { try { _client.stopClient(); } catch {} }
  _client = null;
  _syncReady = false;
  _startPromise = null;
  _syncListeners.clear();
}

// =====================================================================
// AUTH
// =====================================================================

export async function loginMatrix(username: string, password: string) {
  const tempClient = sdk.createClient({ baseUrl: MATRIX_URL });
  const MAX_RETRIES = 2;
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await tempClient.login("m.login.password", { user: username, password });
      localStorage.setItem("mx_access_token", response.access_token);
      localStorage.setItem("mx_user_id", response.user_id);
      localStorage.setItem("mx_device_id", response.device_id);
      stopMatrix();
      return response;
    } catch (e: any) {
      lastError = e;
      if (e?.httpStatus === 429 && attempt < MAX_RETRIES) {
        const waitMs = e?.data?.retry_after_ms || (attempt + 1) * 5000;
        console.warn(`Login 429, ${Math.round(waitMs / 1000)}s kutilmoqda...`);
        await new Promise(r => setTimeout(r, Math.min(waitMs, 15000)));
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

export function logoutMatrix() {
  if (typeof window === "undefined") return;
  try { setPresence(false); } catch {}
  stopMatrix();
  localStorage.removeItem("mx_access_token");
  localStorage.removeItem("mx_user_id");
  localStorage.removeItem("mx_device_id");
}

// =====================================================================
// MESSAGES
// =====================================================================

export async function sendMessage(roomId: string, text: string) {
  const client = getMatrixClient();
  if (!client) throw new Error("Login qilinmagan");
  await client.sendTextMessage(roomId, text);
}

export async function sendReply(roomId: string, text: string, replyToId: string) {
  const client = getMatrixClient();
  if (!client) return;
  await (client as any).sendMessage(roomId, {
    msgtype: "m.text",
    body: text,
    "m.relates_to": { "m.in_reply_to": { event_id: replyToId } },
  });
}

export async function editMessage(roomId: string, eventId: string, newText: string) {
  const client = getMatrixClient();
  if (!client) return;
  await (client as any).sendMessage(roomId, {
    msgtype: "m.text",
    body: `* ${newText}`,
    "m.new_content": { msgtype: "m.text", body: newText },
    "m.relates_to": { rel_type: "m.replace", event_id: eventId },
  });
}

export async function deleteMessage(roomId: string, eventId: string) {
  const client = getMatrixClient();
  if (!client) return;
  await client.redactEvent(roomId, eventId);
}

/**
 * Joylashuv yuborish — Matrix m.location standartiga muvofiq.
 * Element X va Telegram-style preview uchun geo URI qo'shiladi.
 */
export async function sendLocation(roomId: string, lat: number, lng: number) {
  const client = getMatrixClient();
  if (!client) throw new Error("Client yo'q");
  const geoUri = `geo:${lat},${lng}`;
  await (client as any).sendMessage(roomId, {
    msgtype: "m.location",
    body: `Manzil: ${lat}, ${lng}`,
    geo_uri: geoUri,
    "org.matrix.msc3488.location": { uri: geoUri, description: "Joylashuv" },
    "org.matrix.msc3488.asset": { type: "m.self" },
  });
}

/** Xabarni o'qildi deb belgilaydi — debounced (3s) haddan oshmasligi uchun. */
const _readTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function markRoomAsRead(roomId: string) {
  const existing = _readTimers.get(roomId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    _readTimers.delete(roomId);
    const client = getMatrixClient();
    if (!client) return;
    try {
      const room = client.getRoom(roomId);
      if (!room) return;
      const events = room.getLiveTimeline().getEvents();
      const lastEvent = events[events.length - 1];
      if (!lastEvent) return;
      await client.sendReadReceipt(lastEvent);
    } catch (e: any) {
      if (e?.httpStatus !== 429) console.warn("markAsRead:", e?.message);
    }
  }, 3000);
  _readTimers.set(roomId, timer);
}

// =====================================================================
// AUTHENTICATED MEDIA
// =====================================================================

export function mxcToHttp(mxcUrl?: string, useAuth: boolean = true): string | undefined {
  if (!mxcUrl) return undefined;
  if (!mxcUrl.startsWith("mxc://")) return mxcUrl;
  const client = getMatrixClient();
  if (!client) return undefined;

  if (useAuth) {
    const parts = mxcUrl.replace("mxc://", "").split("/");
    if (parts.length >= 2) {
      return `${MATRIX_URL}/_matrix/client/v1/media/download/${parts[0]}/${parts[1]}`;
    }
  }
  return (client as any).mxcUrlToHttp(mxcUrl);
}

// Cache — bir xil mxc URL uchun bir necha bor fetch qilmaymiz
const _mediaBlobCache = new Map<string, string>();

export async function fetchMediaBlob(mxcUrl: string): Promise<string | null> {
  if (!mxcUrl?.startsWith("mxc://")) return mxcUrl;

  // Cache check
  const cached = _mediaBlobCache.get(mxcUrl);
  if (cached) return cached;

  const token = localStorage.getItem("mx_access_token");
  if (!token) return null;

  const httpUrl = mxcToHttp(mxcUrl, true);
  if (!httpUrl) return null;

  try {
    const response = await fetch(httpUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const oldUrl = mxcToHttp(mxcUrl, false);
      if (oldUrl) {
        const r2 = await fetch(oldUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r2.ok) {
          const blob = await r2.blob();
          const url = URL.createObjectURL(blob);
          _mediaBlobCache.set(mxcUrl, url);
          return url;
        }
      }
      return null;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    _mediaBlobCache.set(mxcUrl, url);
    return url;
  } catch (e) {
    console.error("fetchMediaBlob xato:", e);
    return null;
  }
}

// =====================================================================
// MEDIA UPLOAD
// =====================================================================

export async function sendImage(roomId: string, file: File) {
  const client = getMatrixClient();
  if (!client) throw new Error("Client yo'q");

  const dimensions = await getImageDimensions(file);
  const upload = await client.uploadContent(file, { type: file.type, name: file.name });
  const url = (upload as any).content_uri || upload;

  await (client as any).sendMessage(roomId, {
    msgtype: "m.image",
    body: file.name,
    url,
    info: {
      mimetype: file.type,
      size: file.size,
      w: dimensions.width,
      h: dimensions.height,
    },
  });
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = URL.createObjectURL(file);
  });
}

export async function sendFile(roomId: string, file: File) {
  const client = getMatrixClient();
  if (!client) throw new Error("Client yo'q");

  const upload = await client.uploadContent(file, { type: file.type, name: file.name });
  const url = (upload as any).content_uri || upload;

  await (client as any).sendMessage(roomId, {
    msgtype: "m.file",
    body: file.name,
    url,
    info: { mimetype: file.type, size: file.size },
  });
}

export async function sendVoiceMessage(
  roomId: string, blob: Blob, durationMs: number, waveform?: number[]
) {
  const client = getMatrixClient();
  if (!client) throw new Error("Client yo'q");

  const mimeType = blob.type || "audio/ogg";
  const ext = mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a"
    : mimeType.includes("webm") ? "webm" : "ogg";
  const fileName = `voice_${Date.now()}.${ext}`;

  const file = new File([blob], fileName, { type: mimeType });
  const upload = await client.uploadContent(file, { type: mimeType, name: fileName });
  const url = (upload as any).content_uri || upload;

  const wf = waveform && waveform.length > 0
    ? waveform.map(v => Math.max(0, Math.min(1024, Math.round(v * 1024))))
    : Array.from({ length: 30 }, () => Math.floor(200 + Math.random() * 800));

  await (client as any).sendMessage(roomId, {
    msgtype: "m.audio",
    body: fileName,
    url,
    info: { mimetype: mimeType, size: blob.size, duration: Math.round(durationMs) },
    "org.matrix.msc1767.audio": { duration: Math.round(durationMs), waveform: wf },
    "org.matrix.msc1767.file": { url, name: fileName, mimetype: mimeType, size: blob.size },
    "org.matrix.msc1767.text": fileName,
    "org.matrix.msc3245.voice": {},
  });
}

// =====================================================================
// TYPING & PRESENCE
// =====================================================================

export async function sendTyping(roomId: string, typing: boolean) {
  const client = getMatrixClient();
  if (!client) return;
  try { await client.sendTyping(roomId, typing, typing ? 3000 : 0); } catch {}
}

// Strict throttle — bir xil state uchun 60 sekundda 1 marta
let _lastPresence: { state: boolean; time: number } | null = null;

export async function setPresence(online: boolean) {
  const client = getMatrixClient();
  if (!client) return;

  const now = Date.now();
  if (_lastPresence && _lastPresence.state === online && now - _lastPresence.time < 60_000) return;
  _lastPresence = { state: online, time: now };

  try {
    await client.setPresence({ presence: online ? "online" : "offline" });
  } catch (e: any) {
    if (e?.httpStatus === 429) {
      // Rate limit — keyingi urinishni 90 sekund keyinga surish
      _lastPresence = { state: online, time: now + 30_000 };
    } else {
      console.warn("setPresence:", e?.message);
    }
  }
}

// =====================================================================
// NOTIFICATIONS
// =====================================================================

export function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

export function showNotification(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  }
}

// =====================================================================
// VIDEO CALL
// =====================================================================

/**
 * Outgoing call uchun MatrixCall obyektini yaratadi lekin BOSHLAMAYDI.
 * VideoCall komponenti listener'larni bog'lab, keyin call.placeVideoCall()
 * chaqirishi kerak — bu tartib muhim (aks holda stream eventlar o'tkazib yuboriladi).
 */
export function createOutgoingCall(roomId: string): any | null {
  const client = getMatrixClient();
  if (!client) return null;
  if (!client.supportsVoip()) return null;
  return client.createCall(roomId);
}

export function onIncomingCall(handler: (call: any) => void): () => void {
  const client = getMatrixClient();
  if (!client) return () => {};
  const wrapped = (call: any) => handler(call);
  client.on("Call.incoming" as any, wrapped);
  return () => { client.off("Call.incoming" as any, wrapped); };
}
