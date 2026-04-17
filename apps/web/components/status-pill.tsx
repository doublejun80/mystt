"use client";

import { statusLabels, statusTone } from "@mystt/ui-kit";
import type { SessionStatus } from "@mystt/audio-core";

export function StatusPill({ status }: { status: SessionStatus }) {
  const tone = statusTone(status);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "5px 10px",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        color:
          tone === "alert" ? "#ffc1bf" : tone === "cool" ? "#98ffe0" : "#ffe2a7",
        background:
          tone === "alert"
            ? "rgba(255, 110, 110, 0.12)"
            : tone === "cool"
              ? "rgba(26, 200, 140, 0.12)"
              : "rgba(255, 192, 92, 0.12)",
        border: "1px solid rgba(255,255,255,0.08)"
      }}
    >
      {statusLabels[status]}
    </span>
  );
}
