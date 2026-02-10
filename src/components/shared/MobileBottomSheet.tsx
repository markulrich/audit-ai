import { useState, useRef, useCallback, useEffect, type ReactNode, type CSSProperties } from "react";
import { COLORS } from "./certainty-utils";

interface MobileBottomSheetProps {
  onClose: () => void;
  children: ReactNode;
  cardBg?: string;
  handleColor?: string;
  closeButtonColor?: string;
}

const DURATION = 300;
const DISMISS_THRESHOLD = 120;

type Phase = "entering" | "idle" | "dragging" | "snapping" | "closing";

export default function MobileBottomSheet({
  onClose,
  children,
  cardBg,
  handleColor,
  closeButtonColor,
}: MobileBottomSheetProps) {
  const [phase, setPhase] = useState<Phase>("entering");
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartY = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // After entry animation completes, switch to idle
  useEffect(() => {
    if (phase === "entering") {
      const timer = setTimeout(() => setPhase("idle"), DURATION);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const startClose = useCallback((fromDrag?: boolean) => {
    if (phase === "closing") return;
    setPhase("closing");
    if (fromDrag) {
      // Animate from current drag position to off-screen via CSS transition.
      // Current dragOffset is already set; schedule target in next frame.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setDragOffset(window.innerHeight);
        });
      });
    }
    setTimeout(() => onCloseRef.current(), DURATION);
  }, [phase]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (phase !== "idle") return;
    dragStartY.current = e.touches[0].clientY;
    setDragOffset(0);
    setPhase("dragging");
  }, [phase]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (phase !== "dragging") return;
    const delta = Math.max(0, e.touches[0].clientY - dragStartY.current);
    setDragOffset(delta);
  }, [phase]);

  const handleTouchEnd = useCallback(() => {
    if (phase !== "dragging") return;
    if (dragOffset > DISMISS_THRESHOLD) {
      startClose(true);
    } else {
      // Snap back: transition from current offset to 0
      setPhase("snapping");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setDragOffset(0);
        });
      });
      setTimeout(() => setPhase("idle"), DURATION);
    }
  }, [phase, dragOffset, startClose]);

  const handleButtonClose = useCallback(() => {
    if (phase === "closing") return;
    setDragOffset(0);
    startClose(false);
  }, [phase, startClose]);

  const bg = cardBg || COLORS.cardBg;
  const handle = handleColor || COLORS.border;
  const closeBtnColor = closeButtonColor || COLORS.textMuted;

  // Sheet styles by phase
  const sheetStyle = (): CSSProperties => {
    switch (phase) {
      case "entering":
        return { animation: `sheetSlideUp ${DURATION}ms cubic-bezier(0.32, 0.72, 0, 1) forwards` };
      case "idle":
        return {};
      case "dragging":
        return { transform: `translateY(${dragOffset}px)` };
      case "snapping":
        return { transform: `translateY(${dragOffset}px)`, transition: `transform ${DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)` };
      case "closing":
        if (dragOffset > 0) {
          return { transform: `translateY(${dragOffset}px)`, transition: `transform ${DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)` };
        }
        return { animation: `sheetSlideDown ${DURATION}ms cubic-bezier(0.32, 0.72, 0, 1) forwards` };
    }
  };

  const backdropStyle = (): CSSProperties => {
    switch (phase) {
      case "entering":
        return { animation: `sheetBackdropIn ${DURATION}ms ease forwards` };
      case "dragging":
        return { opacity: Math.max(0, 1 - dragOffset / 400) };
      case "snapping":
        return { opacity: Math.max(0, 1 - dragOffset / 400), transition: `opacity ${DURATION}ms ease` };
      case "closing":
        return { animation: `sheetBackdropOut ${DURATION}ms ease forwards` };
      default:
        return { opacity: 1 };
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column" }}>
      {/* Tappable backdrop */}
      <div
        onClick={handleButtonClose}
        style={{
          flex: "0 0 10vh",
          background: "rgba(0,0,0,0.35)",
          ...backdropStyle(),
        }}
      />
      {/* Bottom sheet */}
      <div
        style={{
          flex: 1,
          background: bg,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
          ...sheetStyle(),
        }}
      >
        {/* Drag handle + close */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleButtonClose}
          style={{
            padding: "12px 16px 8px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            position: "relative",
            cursor: "pointer",
            touchAction: "none",
          }}
        >
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: handle,
            }}
          />
          <button
            onClick={(e) => { e.stopPropagation(); handleButtonClose(); }}
            aria-label="Close explanation panel"
            style={{
              position: "absolute",
              right: 12,
              top: 8,
              border: "none",
              background: "transparent",
              fontSize: 18,
              color: closeBtnColor,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 4,
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
