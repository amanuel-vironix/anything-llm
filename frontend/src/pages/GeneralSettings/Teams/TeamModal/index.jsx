import { useEffect, useState } from "react";
import Team from "@/models/team";
import Modal, {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
  ModalSecondaryButton,
  ModalInput,
  ModalLabel,
  ModalHint,
} from "@/components/lib/Modal";

/** Admin-only: create a team or edit its name, description, policy and Google Group. */
export default function TeamModal({
  isOpen,
  closeModal,
  onSuccess,
  team = null,
  policies = [],
}) {
  const isEdit = !!team;
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      name: team?.name || "",
      description: team?.description || "",
      policy_id: team?.policy_id ?? "",
      idp_group: team?.idp_group || "",
    });
    setError(null);
  }, [isOpen, team]);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.name?.trim()) return setError("A name is required.");
    const data = {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      policy_id: form.policy_id === "" ? null : Number(form.policy_id),
      idp_group: form.idp_group?.trim() || null,
    };
    setSaving(true);
    const { team: saved, error: apiError } = isEdit
      ? await Team.update(team.id, data)
      : await Team.create(data);
    setSaving(false);
    if (!saved) return setError(apiError || "Could not save the team.");
    onSuccess(saved);
    closeModal();
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-y-5">
        <ModalHeader
          title={isEdit ? `Edit ${team.name}` : "New team"}
          onClose={closeModal}
        />
        <ModalBody>
          <ModalInput
            label="Name"
            name="name"
            type="text"
            value={form.name || ""}
            onChange={(e) => set({ name: e.target.value })}
            required
          />
          <ModalInput
            label="Description"
            name="description"
            type="text"
            optional
            value={form.description || ""}
            onChange={(e) => set({ description: e.target.value })}
          />
          <div className="flex flex-col gap-y-1.5">
            <ModalLabel htmlFor="policy_id" optional>
              Access policy
            </ModalLabel>
            <select
              id="policy_id"
              value={form.policy_id ?? ""}
              onChange={(e) => set({ policy_id: e.target.value })}
              className="bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 text-sm rounded-[8px] outline-none block w-full h-8 px-3.5"
            >
              <option value="">No policy</option>
              {policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </select>
            <ModalHint>
              Members without a policy of their own use this one.
            </ModalHint>
          </div>
          <ModalInput
            label="Google Group"
            name="idp_group"
            type="text"
            optional
            value={form.idp_group || ""}
            onChange={(e) => set({ idp_group: e.target.value })}
            placeholder="e.g. clinicians@example.org"
            hint="Stored for reference only. Membership is not synced from the group yet."
          />
          {error && (
            <p className="text-xs leading-4 text-red-400 light:text-red-600">
              Error: {error}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryButton type="button" onClick={closeModal}>
            Cancel
          </ModalSecondaryButton>
          <ModalPrimaryButton type="submit" disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Save team" : "Create team"}
          </ModalPrimaryButton>
        </ModalFooter>
      </form>
    </Modal>
  );
}
