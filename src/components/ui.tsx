import type { DayStatusResult } from "@/lib/status";
import { STATUS_LABELS } from "@/lib/status";

type SP = Record<string, string | string[] | undefined>;

export function first(sp: SP, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function Flash({ sp }: { sp: SP }) {
  const ok = first(sp, "ok");
  const error = first(sp, "error");
  return (
    <>
      {ok && (
        <div className="flash ok" role="status">
          {ok}
        </div>
      )}
      {error && (
        <div className="flash error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

export function StatusBadge({ computed, followUpText = true }: { computed: DayStatusResult; followUpText?: boolean }) {
  return (
    <span className="row" style={{ gap: "0.3rem" }}>
      <span className={`badge ${computed.status}`}>
        {computed.status === "no_update" && followUpText ? "No update — follow-up needed" : STATUS_LABELS[computed.status]}
      </span>
      {computed.late && <span className="badge late">Submitted late</span>}
    </span>
  );
}

export function InstagramLink({ handle, url }: { handle: string | null; url: string | null }) {
  if (!handle && !url) return <span className="muted">—</span>;
  const href = url ?? `https://www.instagram.com/${handle}/`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      @{handle ?? href}
    </a>
  );
}

export function PostLink({ url }: { url: string | null }) {
  if (!url) return <span className="muted">—</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break">
      Open on Instagram ↗
    </a>
  );
}
