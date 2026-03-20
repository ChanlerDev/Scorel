import { useState, useEffect, useCallback } from "react";
import type { SessionSummary, SessionDetail } from "@shared/types";

export function useSessionList(opts?: { archived?: boolean }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const archived = opts?.archived ?? false;

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await window.scorel.sessions.list({ archived });
    setSessions(list);
    setLoading(false);
  }, [archived]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sessions, loading, refresh };
}

export function useSessionDetail(sessionId: string | null) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setDetail(null);
      return;
    }

    setLoading(true);
    const nextDetail = await window.scorel.sessions.get(sessionId);
    setDetail(nextDetail);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.scorel.sessions.get(sessionId).then((d) => {
      if (!cancelled) {
        setDetail(d);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { detail, loading, setDetail, refresh };
}
