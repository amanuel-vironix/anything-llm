import { useEffect, useState } from "react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import { CircleNotch, PencilSimple, X } from "@phosphor-icons/react";
import AccessPolicy from "@/models/accessPolicy";
import ModelRouter from "@/models/modelRouter";
import { useModal } from "@/hooks/useModal";
import showToast from "@/utils/toast";
import PolicyModal from "./PolicyModal";
import RoleDefaults from "./RoleDefaults";
import ToolSharing from "./ToolSharing";
import useAgentToolOptions from "./useAgentToolOptions";
import { providerName } from "./ModelListEditor";

const GRID = "grid grid-cols-[2fr_2fr_1fr_1fr_1fr_88px] gap-x-4";

export default function AccessPolicies() {
  const { isOpen, openModal, closeModal } = useModal();
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState([]);
  const [routers, setRouters] = useState([]);
  const [editing, setEditing] = useState(null);
  const toolOptions = useAgentToolOptions();

  const fetchPolicies = async () => {
    const results = await AccessPolicy.getAll();
    setPolicies(results);
    setLoading(false);
  };

  useEffect(() => {
    fetchPolicies();
    ModelRouter.getAll().then(setRouters);
  }, []);

  const openCreate = () => {
    setEditing(null);
    openModal();
  };
  const openEdit = (policy) => {
    setEditing(policy);
    openModal();
  };
  const handleClose = () => {
    closeModal();
    setEditing(null);
  };

  const handleDelete = async (policy) => {
    const users = policy.userCount || 0;
    const teams = policy.teamCount || 0;
    const message =
      users || teams
        ? `Delete the policy "${policy.name}"?\n\n${users} user(s) and ${teams} team(s) use it and will be unassigned. Unassigned users fall back to their role defaults (or their team's policy).`
        : `Delete the policy "${policy.name}"? No users or teams use it.`;
    if (!window.confirm(message)) return;
    const { success, unassigned, error } = await AccessPolicy.delete(policy.id);
    if (!success) {
      showToast(`Could not delete the policy: ${error}`, "error");
      return;
    }
    showToast(
      `Policy deleted. Unassigned ${unassigned?.users ?? 0} user(s) and ${unassigned?.teams ?? 0} team(s).`,
      "success"
    );
    setPolicies((prev) => prev.filter((p) => p.id !== policy.id));
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex md:mt-0 mt-6">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-2xl bg-zinc-900 light:bg-white light:border light:border-slate-300 w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-0 py-16 pb-16">
          <div className="flex items-end justify-between pr-8 py-6 border-b border-white/20 light:border-slate-300">
            <div className="flex flex-col gap-y-2">
              <p className="text-lg font-semibold leading-7 text-white light:text-slate-900">
                Access policies
              </p>
              <p className="text-xs leading-4 text-zinc-400 light:text-slate-600 max-w-[700px]">
                Policies set which models, model router and agent tools a user
                can use. Assign a policy to a user on the Users page or to a
                team on the Teams page. A user&apos;s own policy wins over their
                team&apos;s.
              </p>
            </div>
            <button
              onClick={openCreate}
              className="border-none shrink-0 flex items-center justify-center h-9 px-5 py-2.5 rounded-lg bg-slate-50 text-zinc-950 text-sm font-medium leading-5 hover:opacity-90 transition-opacity duration-200"
            >
              New policy
            </button>
          </div>

          <div className="mt-8 flex flex-col overflow-x-auto">
            <div className="min-w-[720px]">
              <div
                className={`${GRID} px-4 text-sm font-semibold uppercase tracking-[1.4px] text-zinc-500 light:text-slate-500 leading-5`}
              >
                <span>Name</span>
                <span>Models</span>
                <span>Agents</span>
                <span>Users</span>
                <span>Teams</span>
                <span aria-hidden="true" />
              </div>
              <div className="mt-[18px] border-t border-white/20 light:border-slate-300" />
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <CircleNotch className="h-8 w-8 text-zinc-400 animate-spin" />
                </div>
              ) : policies.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 text-center py-16">
                  <p className="text-base font-semibold leading-6 text-zinc-50 light:text-slate-900">
                    No access policies yet
                  </p>
                  <p className="text-sm font-medium leading-5 text-zinc-400 light:text-slate-500 max-w-[370px]">
                    Without a policy, users can use any model and agent tool
                    their role allows.
                  </p>
                </div>
              ) : (
                policies.map((policy, idx) => (
                  <PolicyRow
                    key={policy.id}
                    policy={policy}
                    onEdit={() => openEdit(policy)}
                    onDelete={() => handleDelete(policy)}
                    showDivider={idx < policies.length - 1}
                  />
                ))
              )}
            </div>
          </div>

          <RoleDefaults toolOptions={toolOptions} />
          <ToolSharing
            toolOptions={toolOptions}
            policies={policies}
            onSaved={fetchPolicies}
          />
        </div>
      </div>
      <PolicyModal
        isOpen={isOpen}
        closeModal={handleClose}
        onSuccess={fetchPolicies}
        policy={editing}
        routers={routers}
        toolOptions={toolOptions}
      />
    </div>
  );
}

function modelSummary(allowed) {
  if (allowed === null || allowed === undefined) return "Any model";
  if (allowed.length === 0) return "No models";
  return allowed
    .map(
      ({ provider, model }) =>
        `${providerName(provider)}/${model === "*" ? "any" : model}`
    )
    .join(", ");
}

function agentSummary(policy) {
  if (policy.allow_agents === false) return "Off";
  const rule = policy.agent_tools;
  if (!rule) return "All tools";
  if (rule.allow === null)
    return rule.deny?.length ? `All but ${rule.deny.length}` : "All tools";
  return `${rule.allow.length} allowed`;
}

function PolicyRow({ policy, onEdit, onDelete, showDivider }) {
  const models = modelSummary(policy.allowed_models);
  return (
    <>
      <div
        onClick={onEdit}
        className={`group ${GRID} items-center min-h-9 py-2 px-4 rounded-lg cursor-pointer hover:bg-white/5 light:hover:bg-slate-100 transition-colors`}
      >
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium leading-5 text-white light:text-slate-900 truncate">
            {policy.name}
          </span>
          {policy.description && (
            <span className="text-xs text-zinc-500 light:text-slate-500 truncate">
              {policy.description}
            </span>
          )}
        </div>
        <span
          title={models}
          className="text-sm leading-5 text-zinc-400 light:text-slate-500 truncate"
        >
          {models}
        </span>
        <span className="text-sm leading-5 text-zinc-400 light:text-slate-500">
          {agentSummary(policy)}
        </span>
        <span className="text-sm leading-5 text-zinc-400 light:text-slate-500">
          {policy.userCount || 0}
        </span>
        <span className="text-sm leading-5 text-zinc-400 light:text-slate-500">
          {policy.teamCount || 0}
        </span>
        <div className="flex items-center justify-end gap-[14px]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            aria-label={`Edit ${policy.name}`}
            className="border-none text-zinc-400 light:text-slate-500 hover:text-white light:hover:text-slate-900 transition-colors"
          >
            <PencilSimple size={16} weight="bold" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${policy.name}`}
            className="border-none text-zinc-400 light:text-slate-500 hover:text-red-400 light:hover:text-red-500 transition-colors"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      </div>
      {showDivider && (
        <div className="border-t border-white/10 light:border-slate-200" />
      )}
    </>
  );
}
