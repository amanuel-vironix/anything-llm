import moment from "moment";
import { useEffect, useState } from "react";
import Admin from "@/models/admin";
import { Trash } from "@phosphor-icons/react";
import { userFromStorage } from "@/utils/request";
import System from "@/models/system";
import { useTranslation } from "react-i18next";

/**
 * The multi-user list sends `workspaceIds` parsed; the single-user list sends the raw
 * `workspace_ids` JSON column.
 */
function keyWorkspaceIds(apiKey) {
  if (apiKey.workspaceIds !== undefined) return apiKey.workspaceIds;
  if (!apiKey.workspace_ids) return null;
  try {
    return JSON.parse(apiKey.workspace_ids);
  } catch {
    return null;
  }
}

function workspaceScopeLabel(workspaceIds, workspaces = []) {
  if (!Array.isArray(workspaceIds)) return "All";
  if (workspaceIds.length === 0) return "None";
  const names = workspaceIds.map(
    (id) => workspaces.find((ws) => ws.id === id)?.name || `#${id}`
  );
  return names.join(", ");
}

function expiryLabel(expiresAt) {
  if (!expiresAt) return "Never";
  const when = moment(expiresAt);
  if (when.isBefore(moment()))
    return (
      <span className="text-red-400 light:text-red-600">
        Expired {when.format("ll")}
      </span>
    );
  return when.format("ll");
}

export default function ApiKeyRow({
  apiKey,
  removeApiKey,
  multiUser = false,
  workspaces = [],
  onEdit = null,
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleDelete = async () => {
    if (!window.confirm(t("api.row.deleteConfirm"))) return false;

    const user = userFromStorage();
    const Model = !!user ? Admin : System;
    await Model.deleteApiKey(apiKey.id);
    removeApiKey(apiKey.id);
  };

  const copyApiKey = () => {
    if (!apiKey) return false;
    window.navigator.clipboard.writeText(apiKey.secret);
    setCopied(true);
  };

  useEffect(() => {
    function resetStatus() {
      if (!copied) return false;
      setTimeout(() => {
        setCopied(false);
      }, 3000);
    }
    resetStatus();
  }, [copied]);

  return (
    <>
      <tr className="bg-transparent text-white text-opacity-80 text-xs font-medium border-b border-white/10">
        <td scope="row" className="px-6 py-3 whitespace-nowrap align-middle">
          {apiKey.name || t("api.row.unnamed")}
        </td>
        <td scope="row" className="px-6 py-3 align-middle">
          <code className="font-mono text-[11px] break-all text-theme-text-primary">
            {apiKey.secret}
          </code>
        </td>
        {multiUser && (
          <td className="px-6 py-3 text-left align-middle">
            {apiKey.owner?.username || (
              <span className="text-amber-400 light:text-amber-600">
                No owner
              </span>
            )}
          </td>
        )}
        <td className="px-6 py-3 text-left align-middle">
          {workspaceScopeLabel(keyWorkspaceIds(apiKey), workspaces)}
        </td>
        <td className="px-6 py-3 whitespace-nowrap align-middle">
          {expiryLabel(apiKey.expiresAt)}
        </td>
        <td className="px-6 py-3 whitespace-nowrap align-middle">
          {apiKey.lastUsedAt ? moment(apiKey.lastUsedAt).fromNow() : "Never"}
        </td>
        <td className="px-6 py-3 text-left align-middle">
          {apiKey.createdBy?.username || "--"}
        </td>
        <td className="px-6 py-3 whitespace-nowrap align-middle">
          {moment(apiKey.createdAt).format("lll")}
        </td>
        <td className="px-6 py-3 align-middle">
          <div className="flex items-center gap-x-6">
            <button
              onClick={copyApiKey}
              disabled={copied}
              className="text-xs font-medium text-blue-300 rounded-lg hover:text-white hover:light:text-blue-500 hover:text-opacity-60 hover:underline"
            >
              {copied ? t("api.row.copied") : t("api.row.copy")}
            </button>
            {onEdit && (
              <button
                onClick={onEdit}
                className="text-xs font-medium text-white/80 light:text-black/80 rounded-lg hover:text-white hover:light:text-gray-500 px-2 py-1 hover:bg-white hover:bg-opacity-10"
              >
                Edit
              </button>
            )}
            <button
              onClick={handleDelete}
              className="text-xs font-medium text-white/80 light:text-black/80 hover:light:text-red-500 hover:text-red-300 rounded-lg px-2 py-1 hover:bg-white hover:light:bg-red-50 hover:bg-opacity-10"
            >
              <Trash className="h-5 w-5" />
            </button>
          </div>
        </td>
      </tr>
    </>
  );
}
