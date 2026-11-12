import { useState, useEffect } from "react";
import Modal, {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
  ModalSecondaryButton,
  ModalDangerButton,
  ModalInput,
  ModalTextarea,
} from "@/components/lib/Modal";
import { CMD_REGEX, isReservedCommand } from "./constants";
import showToast from "@/utils/toast";
import Toggle from "@/components/lib/Toggle";

export default function EditPresetModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  preset,
  teamName = null,
}) {
  const [command, setCommand] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [shareWithTeam, setShareWithTeam] = useState(false);
  // Only the owner can share or unshare; leads and admins can still edit a shared one.
  const isOwner = preset?.isOwner !== false;
  const canToggleShare = isOwner && !!teamName;

  useEffect(() => {
    if (preset && isOpen) {
      setCommand(preset.command?.slice(1) || "");
      setShareWithTeam(!!preset.shared);
    }
  }, [preset, isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const sanitizedCommand = command.replace(CMD_REGEX, "");
    if (isReservedCommand(`/${sanitizedCommand}`)) {
      showToast(
        "This command is reserved for system use - please choose another.",
        "error"
      );
      return;
    }
    onSave({
      id: preset.id,
      command: `/${sanitizedCommand}`,
      prompt: form.get("prompt"),
      description: form.get("description"),
      ...(canToggleShare ? { shareWithTeam } : {}),
    });
  };

  const handleCommandChange = (e) => {
    const value = e.target.value.replace(CMD_REGEX, "");
    setCommand(value);
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this preset?")) return;

    setDeleting(true);
    await onDelete(preset.id);
    setDeleting(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-y-5">
        <ModalHeader title="Edit Preset" onClose={onClose} />
        <ModalBody>
          <ModalInput
            label="Command"
            name="command"
            id="command"
            leading="/"
            placeholder="your-command"
            value={command}
            onChange={handleCommandChange}
            required={true}
          />
          <ModalTextarea
            label="Prompt"
            name="prompt"
            id="prompt"
            placeholder="This is a test prompt. Please respond with a poem about LLMs."
            defaultValue={preset.prompt}
            required={true}
          />
          <ModalInput
            label="Description"
            name="description"
            id="description"
            defaultValue={preset.description}
            placeholder="Responds with a poem about LLMs."
            required={true}
          />
          {canToggleShare && (
            <Toggle
              size="md"
              variant="horizontal"
              label="Share with my team"
              description={`Everyone on ${teamName} can use this command.`}
              enabled={shareWithTeam}
              onChange={setShareWithTeam}
            />
          )}
          {!isOwner && preset.shared && (
            <p className="text-xs text-zinc-400 light:text-slate-500">
              This preset is shared with your team by another user. Changes
              apply for everyone on the team.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <ModalDangerButton
            disabled={deleting}
            onClick={handleDelete}
            type="button"
          >
            {deleting ? "Deleting..." : "Delete Preset"}
          </ModalDangerButton>
          <div className="flex gap-x-2">
            <ModalSecondaryButton onClick={onClose} type="button">
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton type="submit">Save</ModalPrimaryButton>
          </div>
        </ModalFooter>
      </form>
    </Modal>
  );
}
