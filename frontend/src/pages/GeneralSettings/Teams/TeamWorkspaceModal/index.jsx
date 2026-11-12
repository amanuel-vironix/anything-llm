import { useEffect, useState } from "react";
import Team from "@/models/team";
import Modal, {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
  ModalSecondaryButton,
  ModalInput,
  ModalTextarea,
  ModalLabel,
} from "@/components/lib/Modal";

const SELECT_CLASS =
  "bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 text-sm rounded-[8px] outline-none block w-full h-8 px-3.5";

const SIMILARITY_OPTIONS = [
  { value: 0.0, label: "No restriction" },
  { value: 0.25, label: "Low (similarity score ≥ .25)" },
  { value: 0.5, label: "Medium (similarity score ≥ .50)" },
  { value: 0.75, label: "High (similarity score ≥ .75)" },
];

/**
 * The workspace settings a team lead may change. Model and provider stay with the
 * admin, so they aren't shown here.
 */
export default function TeamWorkspaceModal({
  isOpen,
  closeModal,
  onSuccess,
  teamId,
  workspace,
}) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !workspace) return;
    setForm({
      name: workspace.name || "",
      openAiPrompt: workspace.openAiPrompt || "",
      openAiTemp: workspace.openAiTemp ?? "",
      openAiHistory: workspace.openAiHistory ?? 20,
      similarityThreshold: workspace.similarityThreshold ?? 0.25,
      topN: workspace.topN ?? 4,
      chatMode: workspace.chatMode || "chat",
      queryRefusalResponse: workspace.queryRefusalResponse || "",
    });
    setError(null);
  }, [isOpen, workspace]);

  if (!workspace) return null;
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.name?.trim()) return setError("A name is required.");
    const data = {
      name: form.name.trim(),
      openAiPrompt: form.openAiPrompt || null,
      openAiTemp: form.openAiTemp === "" ? null : Number(form.openAiTemp),
      openAiHistory: Number(form.openAiHistory),
      similarityThreshold: Number(form.similarityThreshold),
      topN: Number(form.topN),
      chatMode: form.chatMode,
      queryRefusalResponse: form.queryRefusalResponse || null,
    };
    setSaving(true);
    const { workspace: saved, error: apiError } = await Team.updateWorkspace(
      teamId,
      workspace.slug,
      data
    );
    setSaving(false);
    if (!saved) return setError(apiError || "Could not save the workspace.");
    onSuccess(saved);
    closeModal();
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-y-5">
        <ModalHeader
          title={`Workspace settings: ${workspace.name}`}
          subtitle="The model and provider are set by an admin."
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
          <ModalTextarea
            label="System prompt"
            name="openAiPrompt"
            optional
            rows={5}
            value={form.openAiPrompt || ""}
            onChange={(e) => set({ openAiPrompt: e.target.value })}
          />
          <div className="flex gap-x-4">
            <ModalInput
              label="Temperature"
              name="openAiTemp"
              type="number"
              step="0.1"
              min={0}
              optional
              value={form.openAiTemp ?? ""}
              onChange={(e) => set({ openAiTemp: e.target.value })}
            />
            <ModalInput
              label="Chat history"
              name="openAiHistory"
              type="number"
              min={0}
              max={45}
              value={form.openAiHistory ?? ""}
              onChange={(e) => set({ openAiHistory: e.target.value })}
            />
            <ModalInput
              label="Max context snippets"
              name="topN"
              type="number"
              min={1}
              max={200}
              value={form.topN ?? ""}
              onChange={(e) => set({ topN: e.target.value })}
            />
          </div>
          <div className="flex gap-x-4">
            <div className="flex flex-col gap-y-1.5 w-full">
              <ModalLabel htmlFor="chatMode">Chat mode</ModalLabel>
              <select
                id="chatMode"
                value={form.chatMode || "chat"}
                onChange={(e) => set({ chatMode: e.target.value })}
                className={SELECT_CLASS}
              >
                <option value="automatic">Automatic</option>
                <option value="chat">Chat</option>
                <option value="query">Query</option>
              </select>
            </div>
            <div className="flex flex-col gap-y-1.5 w-full">
              <ModalLabel htmlFor="similarityThreshold">
                Document similarity threshold
              </ModalLabel>
              <select
                id="similarityThreshold"
                value={form.similarityThreshold ?? 0.25}
                onChange={(e) => set({ similarityThreshold: e.target.value })}
                className={SELECT_CLASS}
              >
                {SIMILARITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ModalTextarea
            label="Query mode refusal response"
            name="queryRefusalResponse"
            optional
            rows={2}
            value={form.queryRefusalResponse || ""}
            onChange={(e) => set({ queryRefusalResponse: e.target.value })}
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
            {saving ? "Saving..." : "Save workspace"}
          </ModalPrimaryButton>
        </ModalFooter>
      </form>
    </Modal>
  );
}
