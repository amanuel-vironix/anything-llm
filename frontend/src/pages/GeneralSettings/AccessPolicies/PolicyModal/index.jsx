import { useEffect, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import AccessPolicy from "@/models/accessPolicy";
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
import Toggle from "@/components/lib/Toggle";
import ModelListEditor, { ProviderModelRow } from "../ModelListEditor";
import ToolRuleEditor from "../ToolRuleEditor";

function initialState(policy) {
  return {
    name: policy?.name || "",
    description: policy?.description || "",
    restrictModels: Array.isArray(policy?.allowed_models),
    allowedModels: policy?.allowed_models || [],
    defaultProvider: policy?.default_provider || "",
    defaultModel: policy?.default_model || "",
    routerId: policy?.router_id ?? "",
    allowAgents: policy ? policy.allow_agents !== false : true,
    agentTools: policy?.agent_tools || null,
  };
}

/** Create or edit an access policy. */
export default function PolicyModal({
  isOpen,
  closeModal,
  onSuccess,
  policy = null,
  routers = [],
  toolOptions,
}) {
  const isEdit = !!policy;
  const [state, setState] = useState(initialState(policy));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setState(initialState(policy));
    setError(null);
  }, [isOpen, policy]);

  const set = (patch) => setState((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!state.name.trim()) return setError("A name is required.");

    let allowedModels = null;
    if (state.restrictModels) {
      allowedModels = state.allowedModels
        .map((row) => ({
          provider: row.provider?.trim(),
          model: row.model?.trim(),
        }))
        .filter((row) => row.provider || row.model);
      if (allowedModels.some((row) => !row.provider || !row.model))
        return setError("Every allowed model needs a provider and a model.");
    }

    const data = {
      name: state.name.trim(),
      description: state.description.trim() || null,
      allowed_models: allowedModels,
      default_provider: state.defaultProvider || null,
      default_model: state.defaultModel?.trim() || null,
      router_id: state.routerId === "" ? null : Number(state.routerId),
      allow_agents: state.allowAgents,
      agent_tools: state.agentTools,
    };

    setSaving(true);
    const { policy: saved, error: apiError } = isEdit
      ? await AccessPolicy.update(policy.id, data)
      : await AccessPolicy.create(data);
    setSaving(false);
    if (!saved) return setError(apiError || "Could not save the policy.");
    onSuccess();
    closeModal();
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-y-5">
        <ModalHeader
          title={isEdit ? `Edit ${policy.name}` : "New access policy"}
          subtitle="A policy decides which models and agent tools a user or team can use."
          onClose={closeModal}
        />
        <ModalBody>
          <ModalInput
            label="Name"
            name="name"
            type="text"
            value={state.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Clinical staff"
            required
          />
          <ModalInput
            label="Description"
            name="description"
            type="text"
            optional
            value={state.description}
            onChange={(e) => set({ description: e.target.value })}
          />

          <div className="flex flex-col gap-y-3">
            <Toggle
              size="md"
              variant="horizontal"
              label="Restrict models"
              description="When off, users can chat with any model. When on, only the models listed below are allowed. Use * as the model to allow every model of a provider."
              enabled={state.restrictModels}
              onChange={(checked) =>
                set({
                  restrictModels: checked,
                  allowedModels:
                    checked && state.allowedModels.length === 0
                      ? [{ provider: "", model: "" }]
                      : state.allowedModels,
                })
              }
            />
            {state.restrictModels && (
              <ModelListEditor
                value={state.allowedModels}
                onChange={(allowedModels) => set({ allowedModels })}
              />
            )}
          </div>

          <div className="flex flex-col gap-y-1.5">
            <ModalLabel optional>Default model</ModalLabel>
            <ModalHint>
              Used when a workspace doesn&apos;t set its own model. With
              restricted models, it must be one of the allowed models.
            </ModalHint>
            <ProviderModelRow
              provider={state.defaultProvider}
              model={state.defaultModel}
              allowWildcard={false}
              onChange={({ provider, model }) =>
                set({ defaultProvider: provider, defaultModel: model })
              }
            />
          </div>

          <div className="flex flex-col gap-y-1.5">
            <ModalLabel htmlFor="router_id" optional>
              Model router
            </ModalLabel>
            <select
              id="router_id"
              value={state.routerId}
              onChange={(e) => set({ routerId: e.target.value })}
              className="bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 text-sm rounded-[8px] outline-none block w-full h-8 px-3.5"
            >
              <option value="">No router</option>
              {routers.map((router) => (
                <option key={router.id} value={router.id}>
                  {router.name}
                </option>
              ))}
            </select>
          </div>

          <Toggle
            size="md"
            variant="horizontal"
            label="Allow agents"
            description="When off, @agent sessions are refused for users with this policy."
            enabled={state.allowAgents}
            onChange={(checked) => set({ allowAgents: checked })}
          />

          {state.allowAgents && (
            <ToolRuleEditor
              rule={state.agentTools}
              onChange={(agentTools) => set({ agentTools })}
              toolOptions={toolOptions}
            />
          )}

          {error && (
            <p className="text-xs leading-4 text-red-400 light:text-red-600">
              Error: {error}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryButton onClick={closeModal} type="button">
            Cancel
          </ModalSecondaryButton>
          <ModalPrimaryButton type="submit" disabled={saving}>
            {saving ? (
              <>
                <CircleNotch className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : isEdit ? (
              "Save policy"
            ) : (
              "Create policy"
            )}
          </ModalPrimaryButton>
        </ModalFooter>
      </form>
    </Modal>
  );
}
