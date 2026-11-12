import React, { useState } from "react";
import System from "@/models/system";
import showToast from "@/utils/toast";
import {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
  ModalSecondaryButton,
  ModalInput,
  ModalLabel,
} from "@/components/lib/Modal";
import Toggle from "@/components/lib/Toggle";

/**
 * @param {Object} props
 * @param {boolean} [props.isAdmin] - Admins pick who sees the variable (everyone or one team).
 * @param {{id: number, name: string}[]} [props.teams] - Teams an admin can pick.
 * @param {{id: number, name: string}|null} [props.leadOfTeam] - Set for a non-admin team lead, whose variables are always shared with their team.
 */
export default function AddVariableModal({
  closeModal,
  onRefresh,
  isAdmin = true,
  teams = [],
  leadOfTeam = null,
}) {
  const [error, setError] = useState(null);
  const [teamId, setTeamId] = useState("");

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.target);
    const newVariable = {};
    for (const [key, value] of formData.entries())
      newVariable[key] = value.trim();

    if (!newVariable.key || !newVariable.value) {
      setError("Key and value are required");
      return;
    }
    // A lead creates team variables only; the server requires shareWithTeam.
    if (!isAdmin && leadOfTeam) newVariable.shareWithTeam = true;
    if (isAdmin && teamId) newVariable.teamId = Number(teamId);

    try {
      const { success, error } =
        await System.promptVariables.create(newVariable);
      if (!success) throw new Error(error);
      showToast("Variable created successfully", "success", { clear: true });
      if (onRefresh) onRefresh();
      closeModal();
    } catch (error) {
      console.error("Error creating variable:", error);
      setError(error?.message || "Failed to create variable");
    }
  };

  return (
    <form onSubmit={handleCreate} className="flex flex-col gap-y-5">
      <ModalHeader title="Add New Variable" onClose={closeModal} />
      <ModalBody>
        <ModalInput
          label="Key"
          name="key"
          type="text"
          minLength={3}
          maxLength={255}
          placeholder="e.g., company_name"
          required={true}
          autoComplete="off"
          pattern="^[a-zA-Z0-9_]+$"
          hint={
            <>
              Key must be unique and will be used in prompts as {"{key}"}. Only
              letters, numbers and underscores are allowed.
            </>
          }
        />
        <ModalInput
          label="Value"
          name="value"
          type="text"
          placeholder="e.g., Acme Corp"
          required={true}
          autoComplete="off"
        />
        <ModalInput
          label="Description"
          name="description"
          type="text"
          placeholder="Optional description"
          autoComplete="off"
        />
        {isAdmin && teams.length > 0 && (
          <div className="flex flex-col gap-y-1.5">
            <ModalLabel htmlFor="variable-team">Visible to</ModalLabel>
            <select
              id="variable-team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 text-sm rounded-[8px] outline-none block w-full h-8 px-3.5"
            >
              <option value="">Everyone</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  Only {team.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {!isAdmin && leadOfTeam && (
          <Toggle
            size="md"
            variant="horizontal"
            label="Share with my team"
            description={`Team leads create variables for their team only. Everyone on ${leadOfTeam.name} can use this one.`}
            enabled={true}
            disabled={true}
          />
        )}
        {error && <p className="text-red-400 text-sm">Error: {error}</p>}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={closeModal} type="button">
          Cancel
        </ModalSecondaryButton>
        <ModalPrimaryButton type="submit">Create variable</ModalPrimaryButton>
      </ModalFooter>
    </form>
  );
}
