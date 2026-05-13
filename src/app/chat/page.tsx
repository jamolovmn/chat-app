"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ChatList from "@/components/ChatList";
import ChatWindow from "@/components/ChatWindow";
import VideoCall from "@/components/VideoCall";
import {
  startMatrix, waitForSync, getMatrixClient, onIncomingCall,
  setPresence, requestNotificationPermission,
} from "@/lib/matrix";

export default function ChatPage() {
  const router = useRouter();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedRoomName, setSelectedRoomName] = useState<string>("");
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Refs to avoid stale closures in popstate handler
  const showVideoCallRef = useRef(false);
  const selectedRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("mx_access_token");
    if (!token) { router.push("/"); return; }

    // Admin flag — localStorage'dan o'qish
    setIsAdmin(localStorage.getItem("mx_is_admin") === "true");

    let cancelled = false;
    (async () => {
      try {
        await startMatrix();
        await waitForSync();
        if (cancelled) return;
        setPresence(true);
        requestNotificationPermission();
        setReady(true);
      } catch (e) {
        console.error("Matrix start xato:", e);
        if (!cancelled) setReady(true);
      }
    })();

    const handleUnload = () => { try { setPresence(false); } catch {} };
    const handleVisibility = () => {
      try { setPresence(!document.hidden); } catch {}
    };
    window.addEventListener("beforeunload", handleUnload);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", handleUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [router]);

  useEffect(() => {
    if (!ready) return;

    const off = onIncomingCall((call) => {
      if (showVideoCall || incomingCall) {
        try { call.reject(); } catch {}
        return;
      }
      const client = getMatrixClient();
      const room = client?.getRoom(call.roomId || "");
      const name = room?.name || call.getOpponentMember?.()?.name || "Noma'lum";

      setSelectedRoomId(call.roomId || null);
      setSelectedRoomName(name);
      setIncomingCall(call);
      setShowVideoCall(true);
    });
    return off;
  }, [ready, showVideoCall, incomingCall]);

  // Refs in sync with state (popstate handler uses refs to avoid stale closures)
  useEffect(() => { showVideoCallRef.current = showVideoCall; }, [showVideoCall]);
  useEffect(() => { selectedRoomIdRef.current = selectedRoomId; }, [selectedRoomId]);

  // Back button handler — runs once on mount
  useEffect(() => {
    // Push initial state so popstate can fire on first back press
    window.history.pushState({ chatApp: true }, "", "/chat");

    function handlePopState() {
      // Always push a new state so app never exits on back press
      window.history.pushState({ chatApp: true }, "", "/chat");
      if (showVideoCallRef.current) {
        setShowVideoCall(false);
        setIncomingCall(null);
        return;
      }
      if (selectedRoomIdRef.current) {
        setSelectedRoomId(null);
        return;
      }
      // On list screen — stay here, do nothing
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function openRoom(id: string, name: string) {
    setSelectedRoomId(id);
    setSelectedRoomName(name);
    setShowVideoCall(false);
    window.history.pushState({ chatApp: true, room: id }, "", "/chat");
  }

  function goBack() {
    setSelectedRoomId(null);
    // Don't call history.back() — popstate handler manages navigation
  }

  function endCall() {
    setShowVideoCall(false);
    setIncomingCall(null);
  }

  if (!ready) {
    return (
      <div className="h-[100dvh] bg-background flex items-center justify-center">
        <div className="text-outline text-sm">Yuklanmoqda...</div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-background flex overflow-hidden">
      <div className={`w-full md:w-[340px] lg:w-[380px] flex-shrink-0 md:border-r md:border-gray-200/30 ${
        selectedRoomId ? "hidden md:flex" : "flex"} flex-col`}>
        <ChatList
          onSelectRoom={openRoom}
          activeRoomId={selectedRoomId}
          isAdmin={isAdmin}
        />
      </div>

      {selectedRoomId ? (
        <div className="flex-1 flex flex-col w-full">
          <ChatWindow
            key={selectedRoomId}
            roomId={selectedRoomId}
            roomName={selectedRoomName}
            onBack={goBack}
            onVideoCall={() => { setIncomingCall(null); setShowVideoCall(true); }}
          />
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-outline bg-surface-container-low/30">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-surface-container mx-auto mb-4 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-outline">forum</span>
            </div>
            <p className="text-base font-medium text-on-surface-variant">Suhbat tanlang</p>
            <p className="text-sm text-outline mt-1">Chap tarafdan chatni oching</p>
          </div>
        </div>
      )}

      {showVideoCall && selectedRoomId && (
        <VideoCall
          roomId={selectedRoomId}
          callerName={selectedRoomName}
          onEnd={endCall}
          incomingCall={incomingCall}
        />
      )}
    </div>
  );
}
