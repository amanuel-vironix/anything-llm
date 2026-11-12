import { useEffect, useState } from "react";
import Admin from "@/models/admin";
import Modal, {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from "@/components/lib/Modal";
import ApiKeyScopeFields, {
  scopeFromKey,
  scopeToPayload,
} from "../ApiKeyScopeFields";

/** Admin, multi-user: change a key's owner, workspace scope or expiry. */
export default function EditApiKeyModal({
  isOpen,
  closeModal,
  onSuccess,
  apiKey = null,
  users = [],
  workspaces = [],
}) {
  const [scope, setScope] = useState(scopeFromKey(apiKey));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setScope(scopeFromKey(apiKey));
    setError(null);
  }, [isOpen, apiKey]);

  if (!apiKey) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!scope.userId) return setError("Pick an owner for this key.");
    setSaving(true);
    const { apiKey: saved, error: apiError } = await Admin.updateApiKey(
      apiKey.id,
      scopeToPayload(scope, { multiUser: true })
    );
    setSaving(false);
    if (!saved) return setError(apiError || "Could not update the key.");
    onSuccess();
    closeModal();
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-y-5">
        <ModalHeader
          title={`Edit API key${apiKey.name ? `: ${apiKey.name}` : ""}`}
          subtitle={
            apiKey.user_id
              ? null
              : "This key has no owner, so it is refused on every API route until you assign one."
          }
          onClose={closeModal}
        />
        <ModalBody>
          <ApiKeyScopeFields
            scope={scope}
            onChange={setScope}
            multiUser={true}
            users={users}
            workspaces={workspaces}
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
            {saving ? "Saving..." : "Save key"}
          </ModalPrimaryButton>
        </ModalFooter>
      </form>
    </Modal>
  );
}
