import { useEffect, useState } from "react";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import AccessPolicy from "@/models/accessPolicy";
import showToast from "@/utils/toast";
import { ToolSelect } from "../ToolRuleEditor";
import { Section, SaveButton } from "../RoleDefaults";

/**
 * Offer one agent tool to exactly the ticked teams. The server edits each team's
 * policy, so a policy also used by other users or teams changes for them too.
 */
export default function ToolSharing({ toolOptions, policies = [], onSaved }) {
  const [tool, setTool] = useState("");
  const [teams, setTeams] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState(null);

  useEffect(() => {
    setWarning(null);
    if (!tool) {
      setTeams([]);
      setSelected([]);
      return;
    }
    setLoading(true);
    AccessPolicy.toolSharing(tool).then(({ teams: found = [], error }) => {
      if (error) showToast(`Could not load teams: ${error}`, "error");
      setTeams(found || []);
      setSelected((found || []).filter((t) => t.shared).map((t) => t.teamId));
      setLoading(false);
    });
  }, [tool]);

  const toggle = (teamId) =>
    setSelected((prev) =>
      prev.includes(teamId)
        ? prev.filter((id) => id !== teamId)
        : [...prev, teamId]
    );

  const policyName = (policyId) =>
    policies.find((p) => p.id === policyId)?.name || `Policy #${policyId}`;

  const save = async () => {
    setSaving(true);
    const result = await AccessPolicy.setToolSharing(tool, selected);
    setSaving(false);
    if (!result?.success) {
      showToast(`Could not share the tool: ${result?.error}`, "error");
      return;
    }
    setWarning(result.sharedPolicies?.length ? result.sharedPolicies : null);
    showToast(
      `Sharing saved (${result.changed?.length || 0} team(s) changed).`,
      "success"
    );
    onSaved?.();
  };

  return (
    <Section
      title="Share a tool with teams"
      description="Pick an agent tool and tick the teams that should have it. Saving adds or removes the tool on each team's policy."
    >
      <div className="flex flex-col gap-y-4 max-w-[640px]">
        <ToolSelect
          toolOptions={toolOptions}
          value={toolOptions.options.some((o) => o.value === tool) ? tool : ""}
          onChange={setTool}
        />
        {tool && (
          <p className="text-xs text-zinc-400 light:text-slate-600">
            Tool: <code>{toolOptions.labelFor(tool)}</code>
          </p>
        )}
        {loading && (
          <CircleNotch className="h-5 w-5 text-zinc-400 animate-spin" />
        )}
        {!loading && tool && teams.length === 0 && (
          <p className="text-sm text-zinc-400 light:text-slate-500">
            There are no teams yet.
          </p>
        )}
        {!loading && teams.length > 0 && (
          <div className="flex flex-col gap-y-2">
            {teams.map((team) => (
              <label
                key={team.teamId}
                className="flex items-center gap-x-2 text-sm text-white light:text-slate-900 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(team.teamId)}
                  onChange={() => toggle(team.teamId)}
                />
                {team.name}
              </label>
            ))}
            <SaveButton onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save sharing"}
            </SaveButton>
          </div>
        )}
        {warning && (
          <div className="flex gap-x-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 light:text-amber-700 text-xs">
            <Warning size={16} className="shrink-0" />
            <div>
              <p className="font-semibold">
                Some changed policies are also used elsewhere.
              </p>
              <ul className="list-disc pl-4 mt-1">
                {warning.map(({ policyId, others }) => (
                  <li key={policyId}>
                    {policyName(policyId)} is also used by {others} other
                    user(s) or team(s); they got the same change.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
