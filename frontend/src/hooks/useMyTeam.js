import { useEffect, useState } from "react";
import Team from "@/models/team";
import { userFromStorage } from "@/utils/request";

// One request per user per page load; the sidebar and several pages ask for it.
let cache = { userId: null, promise: null };

/** Clear the cached team, e.g. after changing team membership. */
export function refreshMyTeam() {
  cache = { userId: null, promise: null };
}

function loadMyTeam() {
  const user = userFromStorage();
  if (!user?.id) return Promise.resolve({ team: null, role: null });
  if (cache.userId !== user.id || !cache.promise)
    cache = { userId: user.id, promise: Team.mine() };
  return cache.promise;
}

/**
 * The signed-in user's team and their role on it ("member" | "lead" | null).
 * Always `{team: null, role: null}` in single-user mode.
 * @returns {{team: {id: number, name: string, description: string|null}|null, role: "member"|"lead"|null, loading: boolean}}
 */
export default function useMyTeam() {
  const [state, setState] = useState({ team: null, role: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    loadMyTeam().then(({ team, role }) => {
      if (!cancelled) setState({ team, role, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
