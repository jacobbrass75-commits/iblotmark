import { useAuth } from "@/lib/auth";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

type AuthState = "connecting" | "waiting" | "connected" | "error";

interface ApiKeyCreateResponse {
  key: string;
}

interface MeResponse {
  id?: string;
  userId?: string;
  email?: string;
  tier?: string;
}

export default function ExtensionAuth() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const [state, setState] = useState<AuthState>("connecting");
  const [message, setMessage] = useState("Connecting to extension...");
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn) {
      setLocation("/sign-in?redirect=%2Fextension-auth");
      return;
    }

    if (startedRef.current) return;
    startedRef.current = true;

    let acked = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type !== "SM_EXTENSION_AUTH_ACK") return;

      if (event.data?.success === false) {
        setState("error");
        setMessage("Extension rejected the authentication request. Try again.");
        return;
      }

      acked = true;
      setState("connected");
      setMessage("Connected! This tab will close automatically.");
      window.setTimeout(() => {
        window.close();
      }, 800);
    };

    window.addEventListener("message", onMessage);

    const connect = async () => {
      try {
        const keyRes = await apiRequest("POST", "/api/auth/api-keys", { label: "Chrome Extension" });
        const keyData = (await keyRes.json()) as ApiKeyCreateResponse;

        const meRes = await apiRequest("GET", "/api/auth/me");
        const me = (await meRes.json()) as MeResponse;

        setState("waiting");
        setMessage("Waiting for extension confirmation...");

        window.postMessage(
          {
            type: "SM_EXTENSION_AUTH",
            apiKey: keyData.key,
            email: me.email ?? "",
            userId: me.id ?? me.userId ?? "",
            tier: me.tier ?? "free",
          },
          "*"
        );

        window.setTimeout(() => {
          if (!acked) {
            setState("error");
            setMessage("No extension response detected. Make sure the ScholarMark extension is installed.");
          }
        }, 12000);
      } catch (error) {
        console.error("Extension auth failed:", error);
        setState("error");
        setMessage("Failed to create extension API key. Please refresh and try again.");
      }
    };

    void connect();

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [isSignedIn, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-2">ScholarMark Extension</h1>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        <div className="flex items-center gap-3">
          {state === "connected" ? (
            <div className="h-4 w-4 rounded-full bg-green-500" />
          ) : state === "error" ? (
            <div className="h-4 w-4 rounded-full bg-red-500" />
          ) : (
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          )}
          <span className="text-sm">
            {state === "connected" && "Connected"}
            {state === "error" && "Connection failed"}
            {state === "connecting" && "Creating secure key"}
            {state === "waiting" && "Awaiting extension acknowledgement"}
          </span>
        </div>
      </div>
    </div>
  );
}
