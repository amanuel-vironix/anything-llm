import { useEffect, useState } from "react";
import AccessPolicy from "@/models/accessPolicy";
import Team from "@/models/team";
import showToast from "@/utils/toast";

/**
 * Admin-only data for the Users table: every policy, and each user's team. The team
 * column costs one request per team (`/teams/:id/members`), which is fine for the
 * handful of teams an instance has.
 * @param {boolean} enabled - Only admins may call these endpoints.
 * @returns {{policies: object[], teamByUserId: Record<number, {name: string, role: string}>}}
 */
export function useUserAccessInfo(enabled = false) {
  const [policies, setPolicies] = useState([]);
  const [teamByUserId, setTeamByUserId] = useState({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      const [_policies, teams] = await Promise.all([
        AccessPolicy.getAll(),
        Team.getAll(),
      ]);
      const memberLists = await Promise.all(
        teams.map((team) => Team.members(team.id))
      );
      if (cancelled) return;
      const byUser = {};
      teams.forEach((team, i) => {
        for (const member of memberLists[i] || [])
          byUser[member.userId] = { name: team.name, role: member.role };
      });
      setPolicies(_policies);
      setTeamByUserId(byUser);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { policies, teamByUserId };
}

/** Policy dropdown for one user (admin only). */
export function UserPolicyCell({ user, policies = [] }) {
  const [policyId, setPolicyId] = useState(user.policy_id ?? "");
  const [saving, setSaving] = useState(false);

  const handleChange = async (e) => {
    const next = e.target.value;
    const previous = policyId;
    setPolicyId(next);
    setSaving(true);
    const { success, error } = await AccessPolicy.assignToUser(
      user.id,
      next === "" ? null : Number(next)
    );
    setSaving(false);
    if (!success) {
      setPolicyId(previous);
      showToast(`Could not change the policy: ${error}`, "error", {
        clear: true,
      });
      return;
    }
    showToast(`Policy updated for ${user.username}.`, "success", {
      clear: true,
    });
  };

  return (
    <td className="px-6">
      <select
        value={policyId}
        onChange={handleChange}
        disabled={saving}
        aria-label={`Access policy for ${user.username}`}
        className="bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 text-xs rounded-[6px] outline-none h-7 px-2 max-w-[160px] disabled:opacity-50"
      >
        <option value="">
          {user.role === "admin" ? "None (admin)" : "None"}
        </option>
        {policies.map((policy) => (
          <option key={policy.id} value={policy.id}>
            {policy.name}
          </option>
        ))}
      </select>
    </td>
  );
}

/** Read-only team name and role for one user. */
export function UserTeamCell({ team = null }) {
  return (
    <td className="px-6 whitespace-nowrap">
      {team ? `${team.name}${team.role === "lead" ? " (lead)" : ""}` : "--"}
    </td>
  );
}
