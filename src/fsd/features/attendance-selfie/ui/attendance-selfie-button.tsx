"use client";

import { Camera, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./attendance-selfie-button.module.css";

export type AttendanceSelfie = {
  name: string;
  mimeType: "image/jpeg";
  data: string;
};

export function AttendanceSelfieButton({
  action,
  disabled,
  pending,
  className,
  onCapture,
}: {
  action: "open" | "close";
  disabled?: boolean;
  pending?: boolean;
  className?: string;
  onCapture: (selfie: AttendanceSelfie) => void;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError("");
    setCameraReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Камера не поддерживается этим браузером.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" }, width: { ideal: 960 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (caught) {
      setCameraError(caught instanceof Error ? caught.message : "Не удалось открыть фронтальную камеру.");
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!cameraOpen) return;
    const timer = window.setTimeout(() => void startCamera(), 0);
    return () => {
      window.clearTimeout(timer);
      stopCamera();
    };
  }, [cameraOpen, startCamera, stopCamera]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("Камера ещё не готова. Попробуйте ещё раз.");
      return;
    }
    setCapturing(true);
    try {
      const maxSide = 960;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось обработать снимок.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
      if (!blob) throw new Error("Не удалось сохранить снимок.");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Не удалось прочитать снимок."));
        reader.readAsDataURL(blob);
      });
      stopCamera();
      setCameraOpen(false);
      onCapture({
        name: `attendance-${action}-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        data: dataUrl.split(",")[1] || "",
      });
    } catch (caught) {
      setCameraError(caught instanceof Error ? caught.message : "Не удалось сделать селфи.");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <>
      <button type="button" className={className} disabled={disabled || pending} onClick={() => setCameraOpen(true)}>
        <Camera size={18} />
        {pending ? "Отправляем селфи…" : action === "open" ? "Селфи и открыть смену" : "Селфи и закрыть смену"}
      </button>
      {cameraOpen ? (
        <div className={styles.backdrop} role="presentation">
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="attendance-selfie-title">
            <header>
              <div>
                <span>Подтверждение личности</span>
                <h2 id="attendance-selfie-title">Посмотрите в камеру</h2>
                <p>Селфи отправится только в закрытую Telegram-группу посещаемости.</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setCameraOpen(false)} aria-label="Закрыть камеру">
                <X size={20} />
              </button>
            </header>
            <div className={styles.cameraFrame}>
              <video ref={videoRef} muted playsInline />
              {!cameraReady && !cameraError ? <span>Включаем фронтальную камеру…</span> : null}
              <div className={styles.faceGuide} aria-hidden="true" />
            </div>
            {cameraError ? <div className={styles.error}>{cameraError}</div> : null}
            <footer>
              {cameraError ? (
                <button type="button" className={styles.secondaryButton} onClick={() => void startCamera()}>
                  <RefreshCw size={18} /> Повторить
                </button>
              ) : null}
              <button type="button" onClick={() => void capture()} disabled={!cameraReady || capturing}>
                <Camera size={19} /> {capturing ? "Обрабатываем…" : "Сфотографироваться"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
