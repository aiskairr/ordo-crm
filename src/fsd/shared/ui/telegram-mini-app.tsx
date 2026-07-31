"use client";

import Script from "next/script";
import { useCallback } from "react";

type TelegramWebApp = {
  platform?: string;
  colorScheme?: "light" | "dark";
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: "bg_color" | "secondary_bg_color" | `#${string}`) => void;
  setBackgroundColor?: (color: "bg_color" | "secondary_bg_color" | `#${string}`) => void;
  onEvent?: (event: "themeChanged", handler: () => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function TelegramMiniApp() {
  const initialize = useCallback(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp || webApp.platform === "unknown") return;

    const root = document.documentElement;
    const applyTheme = () => {
      root.dataset.telegramMiniApp = "true";
      root.style.colorScheme = webApp.colorScheme === "dark" ? "dark" : "light";
    };

    applyTheme();
    webApp.onEvent?.("themeChanged", applyTheme);
    webApp.setHeaderColor?.("bg_color");
    webApp.setBackgroundColor?.("bg_color");
    webApp.expand();
    webApp.ready();
  }, []);

  return (
    <Script
      id="telegram-web-app-sdk"
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onReady={initialize}
    />
  );
}
