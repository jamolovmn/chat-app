"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createOutgoingCall, startMatrix, waitForSync } from "@/lib/matrix";
import { CallEvent, CallState, CallErrorCode } from "matrix-js-sdk/lib/webrtc/call";
import type { MatrixCall } from "matrix-js-sdk/lib/webrtc/call";
import type { CallFeed } from "matrix-js-sdk/lib/webrtc/callFeed";

interface Props {
  roomId: string;
  callerName: string;
  onEnd: () => void;
  incomingCall?: MatrixCall | null;
}

type UiState = "calling" | "ringing" | "connecting" | "connected" | "ended";

const COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9"];
function getColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function VideoCall({ roomId, callerName, onEnd, incomingCall }: Props) {
  const [uiState, setUiState]               = useState<UiState>(incomingCall ? "ringing" : "calling");
  const [micOn, setMicOn]                   = useState(true);
  const [camOn, setCamOn]                   = useState(true);
  const [speakerOn, setSpeakerOn]           = useState(true);
  const [elapsed, setElapsed]               = useState(0);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [errorMsg, setErrorMsg]             = useState<string | null>(null);
  const [videoSwapped, setVideoSwapped]     = useState(false);  // PiP <-> fullscreen swap

  const localVideoRef   = useRef<HTMLVideoElement>(null);
  const remoteVideoRef  = useRef<HTMLVideoElement>(null);
  const callRef         = useRef<MatrixCall | null>(null);
  const localStreamRef  = useRef<MediaStream | null>(null);
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef      = useRef(true);
  const initializedRef  = useRef(false);

  // ── Stream attach ─────────────────────────────────────────────────

  const attachLocalStream = useCallback((call: MatrixCall) => {
    const stream = call.localUsermediaStream;
    if (!stream || !localVideoRef.current) return;
    if (localVideoRef.current.srcObject !== stream) {
      localVideoRef.current.srcObject = stream;
      localStreamRef.current = stream;
    }
    // Mobil brauzerlarda autoplay ko'pincha ishlamaydi — majburiy play()
    localVideoRef.current.muted = true;
    localVideoRef.current.playsInline = true;
    localVideoRef.current.play().catch(err => {
      console.warn("Local video play() xato:", err?.message);
    });
  }, []);

  const attachRemoteStream = useCallback((call: MatrixCall) => {
    const stream = call.remoteUsermediaStream;
    if (!stream) { setHasRemoteVideo(false); return; }
    const el = remoteVideoRef.current;
    if (el && el.srcObject !== stream) {
      el.srcObject = stream;
      el.muted = false;  // always start unmuted (speaker on by default)
      el.playsInline = true;
      el.play().catch(() => {});
    }
    const hasVid = stream.getVideoTracks().some(t => t.enabled && t.readyState === "live");
    setHasRemoteVideo(hasVid);
  }, []);

  // ── Sync speaker volume state ─────────────────────────────────────

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.volume = speakerOn ? 1.0 : 0.3;
    }
  }, [speakerOn]);

  // ── Event listeners ───────────────────────────────────────────────

  const attachListeners = useCallback((call: MatrixCall) => {

    call.on(CallEvent.State, (state: CallState) => {
      if (!mountedRef.current) return;
      switch (state) {
        case CallState.WaitLocalMedia:
        case CallState.CreateOffer:
        case CallState.InviteSent:
          setUiState("calling");
          break;
        case CallState.Ringing:
          setUiState("ringing");
          break;
        case CallState.CreateAnswer:
        case CallState.Connecting:
          setUiState("connecting");
          break;
        case CallState.Connected:
          setUiState("connected");
          attachLocalStream(call);
          attachRemoteStream(call);
          break;
        case CallState.Ended:
          setUiState("ended");
          setTimeout(() => { if (mountedRef.current) onEnd(); }, 800);
          break;
      }
    });

    call.on(CallEvent.FeedsChanged, (_feeds: CallFeed[]) => {
      if (!mountedRef.current) return;
      attachLocalStream(call);
      attachRemoteStream(call);
    });

    call.on(CallEvent.Hangup, () => {
      if (!mountedRef.current) return;
      setUiState("ended");
      setTimeout(() => { if (mountedRef.current) onEnd(); }, 800);
    });

    call.on(CallEvent.Error, (err: any) => {
      if (!mountedRef.current) return;
      console.error("MatrixCall error:", err);
      setErrorMsg(err?.message || "Qo'ng'iroq xatosi");
    });

  }, [attachLocalStream, attachRemoteStream, onEnd]);

  // ── Setup ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    mountedRef.current = true;

    (async () => {
      try {
        await startMatrix();
        await waitForSync();
        if (!mountedRef.current) return;

        if (incomingCall) {
          callRef.current = incomingCall;
          attachListeners(incomingCall);
          if (incomingCall.state === CallState.Ended) {
            setUiState("ended");
            setTimeout(() => { if (mountedRef.current) onEnd(); }, 500);
          }
        } else {
          const client = (await import("@/lib/matrix")).getMatrixClient();
          if (!client) throw new Error("Matrix client yo'q");
          if (!client.supportsVoip()) throw new Error("Brauzeringiz WebRTC'ni qo'llab-quvvatlamaydi");

          // Mobil brauzerlarda HTTPS bo'lmasa getUserMedia ishlamaydi — oldindan tekshirish
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Kamera/mikrofon API mavjud emas. HTTPS ulanish kerak.");
          }

          const call = createOutgoingCall(roomId);
          if (!call) throw new Error("Qo'ng'iroq yaratib bo'lmadi");

          callRef.current = call;
          attachListeners(call);
          await call.placeVideoCall();
          if (!mountedRef.current) {
            call.hangup(CallErrorCode.UserHangup, true);
            return;
          }
          // Stream tayyor bo'lishi uchun bir necha martta urinib ko'ramiz
          attachLocalStream(call);
          for (const ms of [100, 300, 800, 1500]) {
            setTimeout(() => {
              if (mountedRef.current && callRef.current) attachLocalStream(callRef.current);
            }, ms);
          }
        }
      } catch (err: any) {
        if (!mountedRef.current) return;
        console.error("VideoCall setup xato:", err);
        const msg = err?.name === "NotAllowedError"
          ? "Kamera/mikrofon ruxsati rad etildi. Brauzer sozlamalaridan ruxsat bering."
          : err?.name === "NotFoundError"
          ? "Kamera yoki mikrofon topilmadi"
          : err?.name === "NotReadableError"
          ? "Kamera band — boshqa ilova ishlatmoqda"
          : (err?.message || "Kamera/mikrofon ruxsati kerak yoki ulanish xatosi");
        setErrorMsg(msg);
        setTimeout(() => { if (mountedRef.current) onEnd(); }, 3500);
      }
    })();

    return () => {
      mountedRef.current = false;
      initializedRef.current = false;
      clearInterval(timerRef.current!);
      clearTimeout(hideTimerRef.current!);

      const call = callRef.current;
      if (call && call.state !== CallState.Ended) {
        try { call.hangup(CallErrorCode.UserHangup, true); } catch {}
      }
      callRef.current = null;

      const stream = localStreamRef.current;
      if (stream) {
        stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
        localStreamRef.current = null;
      }
      if (localVideoRef.current)  localVideoRef.current.srcObject  = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Timer ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (uiState === "connected") {
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    } else {
      clearInterval(timerRef.current!);
    }
    return () => clearInterval(timerRef.current!);
  }, [uiState]);

  // ── Incoming call handlers ─────────────────────────────────────────

  async function handleAccept() {
    const call = callRef.current;
    if (!call || call.state === CallState.Ended) return;
    setUiState("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Kamera/mikrofon API mavjud emas. HTTPS ulanish kerak.");
      }
      await call.answer(true, true);
      // Stream tayyorlashga vaqt berish — mobilda kechikishi mumkin
      for (const ms of [100, 300, 800, 1500]) {
        setTimeout(() => {
          if (mountedRef.current && callRef.current) attachLocalStream(callRef.current);
        }, ms);
      }
    } catch (err: any) {
      console.error("answer() xato:", err);
      const msg = err?.name === "NotAllowedError"
        ? "Kamera/mikrofon ruxsati rad etildi"
        : (err?.message || "Qabul qilishda xato");
      setErrorMsg(msg);
      setTimeout(() => { if (mountedRef.current) onEnd(); }, 2500);
    }
  }

  function handleReject() {
    const call = callRef.current;
    if (call && call.state !== CallState.Ended) {
      try { call.reject(); } catch {}
    }
    onEnd();
  }

  // ── In-call controls ──────────────────────────────────────────────

  function handleEnd() {
    const call = callRef.current;
    if (call && call.state !== CallState.Ended) {
      try { call.hangup(CallErrorCode.UserHangup, true); } catch {}
    }
    onEnd();
  }

  async function toggleMic() {
    const call = callRef.current;
    const next = !micOn;
    setMicOn(next);
    if (!call) return;
    try {
      await call.setMicrophoneMuted(!next);
    } catch (e) {
      console.warn("setMicrophoneMuted:", e);
    }
    // Belt-and-suspenders: also toggle track level
    call.localUsermediaStream?.getAudioTracks().forEach(t => { t.enabled = next; });
  }

  async function toggleCam() {
    const call = callRef.current;
    const next = !camOn;
    setCamOn(next);
    if (!call) return;
    try {
      await call.setLocalVideoMuted(!next);
    } catch (e) {
      console.warn("setLocalVideoMuted:", e);
    }
    call.localUsermediaStream?.getVideoTracks().forEach(t => { t.enabled = next; });
  }

  function toggleSpeaker() {
    setSpeakerOn(prev => !prev);
  }

  function formatTime(s: number) {
    return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  }

  function handleTap() {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current!);
    hideTimerRef.current = setTimeout(() => { if (mountedRef.current) setControlsVisible(false); }, 4000);
  }

  // ── UI ────────────────────────────────────────────────────────────

  const showRemoteVideo = (uiState === "connected" || uiState === "connecting") && hasRemoteVideo;
  const initials    = callerName.slice(0, 2).toUpperCase();
  const avatarColor = getColor(callerName);

  const statusLabel: Record<UiState, string> = {
    calling:    "Qo'ng'iroq qilinmoqda...",
    ringing:    "Kelayotgan qo'ng'iroq",
    connecting: "Ulanmoqda...",
    connected:  formatTime(elapsed),
    ended:      "Tugatildi",
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#1a1a2e] flex flex-col overflow-hidden select-none"
      onClick={handleTap}
    >
      {/* ── Video area ── */}
      <div className="absolute inset-0">

        {/* Remote video — fullscreen default, PiP when swapped */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          onClick={videoSwapped && showRemoteVideo ? (e) => { e.stopPropagation(); setVideoSwapped(false); } : undefined}
          className={[
            "absolute object-cover transition-all duration-300",
            videoSwapped
              ? "top-4 right-4 w-[90px] h-[130px] md:w-[110px] md:h-[160px] rounded-2xl z-20 shadow-2xl border-2 border-white/20"
              : "inset-0 w-full h-full",
            showRemoteVideo ? "opacity-100" : "opacity-0 pointer-events-none",
            videoSwapped && showRemoteVideo ? "cursor-pointer" : "",
          ].join(" ")}
        />

        {/* Local video — PiP default (top-right), fullscreen when swapped */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          onClick={!videoSwapped ? (e) => { e.stopPropagation(); setVideoSwapped(true); } : undefined}
          className={[
            "absolute object-cover transition-all duration-300",
            videoSwapped
              ? "inset-0 w-full h-full scale-x-[-1]"
              : "top-4 right-4 w-[90px] h-[130px] md:w-[110px] md:h-[160px] rounded-2xl z-20 shadow-2xl border-2 border-white/20 scale-x-[-1]",
            camOn ? "opacity-100" : "opacity-0 pointer-events-none",
            !videoSwapped ? "cursor-pointer" : "",
          ].join(" ")}
        />

        {/* Camera off placeholder — only in PiP position and cam off */}
        {!camOn && !videoSwapped && (
          <div className="absolute top-4 right-4 w-[90px] h-[130px] md:w-[110px] md:h-[160px] rounded-2xl z-20 border-2 border-white/10 bg-[#2a2a3e] flex items-center justify-center pointer-events-none">
            <span className="material-symbols-outlined text-white/30 text-3xl">videocam_off</span>
          </div>
        )}

        {/* Avatar + status (when no remote video) */}
        {!showRemoteVideo && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              {/* Avatar with concentric ring animations */}
              <div
                className="relative flex items-center justify-center"
                style={{ width: "96px", height: "96px" }}
              >
                {(uiState === "calling" || uiState === "ringing") && (
                  <>
                    <div
                      className="absolute rounded-full animate-ping"
                      style={{
                        backgroundColor: avatarColor,
                        opacity: 0.25,
                        width: "136px", height: "136px",
                        left: "-20px", top: "-20px",
                      }}
                    />
                    <div
                      className="absolute rounded-full animate-ping"
                      style={{
                        backgroundColor: avatarColor,
                        opacity: 0.15,
                        width: "176px", height: "176px",
                        left: "-40px", top: "-40px",
                        animationDelay: "0.4s",
                      }}
                    />
                    <div
                      className="absolute rounded-full animate-ping"
                      style={{
                        backgroundColor: avatarColor,
                        opacity: 0.07,
                        width: "216px", height: "216px",
                        left: "-60px", top: "-60px",
                        animationDelay: "0.8s",
                      }}
                    />
                  </>
                )}
                <div
                  className="relative z-10 w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-2xl"
                  style={{ backgroundColor: avatarColor }}
                >
                  {initials}
                </div>
              </div>

              <h1 className="text-white text-xl md:text-2xl font-bold mt-2">{callerName}</h1>
              <p className="text-white/60 text-sm flex items-center gap-1.5">
                {uiState !== "ended" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                )}
                <span className="font-medium tabular-nums">{statusLabel[uiState]}</span>
              </p>
              {errorMsg && (
                <p className="text-red-300 text-xs max-w-[270px] text-center bg-red-500/15 border border-red-500/20 px-4 py-2.5 rounded-2xl leading-relaxed">
                  {errorMsg}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Timer overlay (when remote video is showing) */}
        {showRemoteVideo && (
          <div className="absolute top-4 left-4 z-30">
            <div className="bg-black/40 backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white text-xs font-medium tabular-nums">{formatTime(elapsed)}</span>
            </div>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none z-10" />
      </div>

      {/* ── INCOMING: Accept / Reject buttons ── */}
      {uiState === "ringing" && (
        <div
          className="absolute bottom-0 left-0 right-0 z-30 pb-14 md:pb-16 px-4 flex justify-center"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-center gap-14">
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleReject}
                className="w-16 h-16 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 active:scale-90 transition-all shadow-lg shadow-red-500/40"
              >
                <span
                  className="material-symbols-outlined text-white text-[28px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  call_end
                </span>
              </button>
              <span className="text-white/60 text-[11px]">Rad etish</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleAccept}
                className="w-16 h-16 flex items-center justify-center rounded-full bg-green-500 hover:bg-green-600 active:scale-90 transition-all shadow-lg shadow-green-500/40 animate-pulse"
              >
                <span
                  className="material-symbols-outlined text-white text-[28px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  call
                </span>
              </button>
              <span className="text-white/60 text-[11px]">Qabul qilish</span>
            </div>
          </div>
        </div>
      )}

      {/* ── CONNECTED/CALLING: Control bar ── */}
      {controlsVisible && uiState !== "ringing" && (
        <div
          className="absolute bottom-0 left-0 right-0 z-30 pb-8 md:pb-10 px-4 flex justify-center"
          onClick={e => e.stopPropagation()}
        >
          <div className="bg-white/10 backdrop-blur-2xl border border-white/10 rounded-full px-3 py-2.5 flex items-center gap-3">
            <button
              onClick={toggleMic}
              className={`w-12 h-12 md:w-14 md:h-14 flex items-center justify-center rounded-full transition-all active:scale-90 ${
                micOn ? "bg-white/10" : "bg-red-500"
              }`}
            >
              <span className="material-symbols-outlined text-white text-[22px] md:text-[26px]">
                {micOn ? "mic" : "mic_off"}
              </span>
            </button>

            <button
              onClick={toggleCam}
              className={`w-12 h-12 md:w-14 md:h-14 flex items-center justify-center rounded-full transition-all active:scale-90 ${
                camOn ? "bg-white/10" : "bg-red-500"
              }`}
            >
              <span className="material-symbols-outlined text-white text-[22px] md:text-[26px]">
                {camOn ? "videocam" : "videocam_off"}
              </span>
            </button>

            <button
              onClick={handleEnd}
              className="w-14 h-12 md:w-16 md:h-14 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 active:scale-90 transition-all shadow-lg shadow-red-500/30"
            >
              <span
                className="material-symbols-outlined text-white text-[26px] md:text-[28px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                call_end
              </span>
            </button>

            <button
              onClick={toggleSpeaker}
              className={`w-12 h-12 md:w-14 md:h-14 flex items-center justify-center rounded-full transition-all active:scale-90 ${
                speakerOn ? "bg-white/10" : "bg-red-500"
              }`}
            >
              <span className="material-symbols-outlined text-white text-[22px] md:text-[26px]">
                {speakerOn ? "volume_up" : "volume_off"}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
