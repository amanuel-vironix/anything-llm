import { useEffect, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import AccessPolicy from "@/models/accessPolicy";
import showToast from "@/utils/toast";
import ToolRuleEditor from "../ToolRuleEditor";

const ROLES = [
  {
    role: "manager",
    label: "Managers",
    description: "Applies to managers who have no policy of their own.",
  },
  {
    role: "default",
    label: "Default users",
    description: "Applies to default users who have no policy of their own.",
  },
];

/** Edit the agent tool rule each role gets when no policy says otherwise. */
export default function RoleDefaults({ toolOptions }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [rules, setRules] = useState({ manager: null, default: null });

  useEffect(() => {
    AccessPolicy.getRoleDefaults().then((roleDefaults) => {
      setRules({
        manager: roleDefaults?.manager || null,
        default: roleDefaults?.default || null,
      });
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const { success, roleDefaults, error } =
      await AccessPolicy.updateRoleDefaults(rules);
    setSaving(false);
    if (!success) {
      showToast(`Could not save role defaults: ${error}`, "error");
      return;
    }
    setRules({
      manager: roleDefaults?.manager || null,
      default: roleDefaults?.default || null,
    });
    setChanged(false);
    showToast("Role defaults saved.", "success");
  };

  return (
    <Section
      title="Role defaults"
      description="Agent tool rules for users with no access policy, by role. Admins are never restricted."
    >
      {loading ? (
        <CircleNotch className="h-6 w-6 text-zinc-400 animate-spin" />
      ) : (
        <div className="flex flex-col gap-y-6">
          {ROLES.map(({ role, label, description }) => (
            <div key={role} className="flex flex-col gap-y-2 max-w-[640px]">
              <ToolRuleEditor
                rule={rules[role]}
                restrictLabel={label}
                restrictDescription={`${description} When off, they can use every tool.`}
                onChange={(rule) => {
                  setRules((prev) => ({ ...prev, [role]: rule }));
                  setChanged(true);
                }}
                toolOptions={toolOptions}
              />
            </div>
          ))}
          <SaveButton onClick={save} disabled={!changed || saving}>
            {saving ? "Saving..." : "Save role defaults"}
          </SaveButton>
        </div>
      )}
    </Section>
  );
}

export function Section({ title, description, children }) {
  return (
    <div className="mt-10 flex flex-col gap-y-4">
      <div className="flex flex-col gap-y-1 pb-3 border-b border-white/20 light:border-slate-300">
        <p className="text-base font-semibold leading-6 text-white light:text-slate-900">
          {title}
        </p>
        {description && (
          <p className="text-xs leading-4 text-zinc-400 light:text-slate-600 max-w-[700px]">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export function SaveButton({ children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className="border-none self-start flex items-center justify-center h-9 px-5 rounded-lg bg-slate-50 text-zinc-950 text-sm font-medium hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
