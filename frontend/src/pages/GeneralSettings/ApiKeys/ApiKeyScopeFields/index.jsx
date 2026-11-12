import moment from "moment";
import { ModalLabel, ModalHint } from "@/components/lib/Modal";

const FIELD_CLASS =
  "bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 text-sm rounded-[8px] outline-none block w-full h-8 px-3.5";

/**
 * Turn an API key from the server into form state.
 * @returns {{userId: string, restrictWorkspaces: boolean, workspaceIds: number[], expiresOn: string}}
 */
export function scopeFromKey(apiKey = null, defaultUserId = "") {
  return {
    userId: String(apiKey?.user_id ?? apiKey?.owner?.id ?? defaultUserId ?? ""),
    restrictWorkspaces: Array.isArray(apiKey?.workspaceIds),
    workspaceIds: apiKey?.workspaceIds || [],
    expiresOn: apiKey?.expiresAt
      ? moment(apiKey.expiresAt).format("YYYY-MM-DD")
      : "",
  };
}

/** Turn form state into the request body fields the server takes. */
export function scopeToPayload(scope, { multiUser }) {
  return {
    ...(multiUser && scope.userId ? { userId: Number(scope.userId) } : {}),
    workspaceIds: scope.restrictWorkspaces ? scope.workspaceIds : null,
    // End of the chosen day, local time.
    expiresAt: scope.expiresOn
      ? moment(scope.expiresOn, "YYYY-MM-DD").endOf("day").toISOString()
      : null,
  };
}

/**
 * Owner, workspace scope and expiry fields shared by the create and edit modals.
 * The owner picker only shows in multi-user mode, where every key runs as its owner.
 */
export default function ApiKeyScopeFields({
  scope,
  onChange,
  multiUser = false,
  users = [],
  workspaces = [],
}) {
  const set = (patch) => onChange({ ...scope, ...patch });
  const toggleWorkspace = (id) =>
    set({
      workspaceIds: scope.workspaceIds.includes(id)
        ? scope.workspaceIds.filter((w) => w !== id)
        : [...scope.workspaceIds, id],
    });

  return (
    <>
      {multiUser && (
        <div className="flex flex-col gap-y-1.5">
          <ModalLabel htmlFor="api-key-owner">Owner</ModalLabel>
          <select
            id="api-key-owner"
            value={scope.userId}
            onChange={(e) => set({ userId: e.target.value })}
            className={FIELD_CLASS}
          >
            <option value="">Select a user</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.username} ({user.role})
                {user.suspended ? " - suspended" : ""}
              </option>
            ))}
          </select>
          <ModalHint>
            The key acts as this user and can only do what they can do.
          </ModalHint>
        </div>
      )}

      <div className="flex flex-col gap-y-1.5">
        <ModalLabel>Workspaces</ModalLabel>
        <label className="flex items-center gap-x-2 text-sm text-white light:text-slate-900">
          <input
            type="radio"
            checked={!scope.restrictWorkspaces}
            onChange={() => set({ restrictWorkspaces: false })}
          />
          {multiUser ? "Every workspace the owner can reach" : "All workspaces"}
        </label>
        <label className="flex items-center gap-x-2 text-sm text-white light:text-slate-900">
          <input
            type="radio"
            checked={scope.restrictWorkspaces}
            onChange={() => set({ restrictWorkspaces: true })}
          />
          Only these workspaces
        </label>
        {scope.restrictWorkspaces && (
          <div className="flex flex-col gap-y-1 max-h-[160px] overflow-y-auto pl-6">
            {workspaces.length === 0 && (
              <p className="text-xs text-zinc-400">No workspaces.</p>
            )}
            {workspaces.map((ws) => (
              <label
                key={ws.id}
                className="flex items-center gap-x-2 text-sm text-white light:text-slate-900"
              >
                <input
                  type="checkbox"
                  checked={scope.workspaceIds.includes(ws.id)}
                  onChange={() => toggleWorkspace(ws.id)}
                />
                {ws.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-y-1.5">
        <ModalLabel htmlFor="api-key-expiry" optional>
          Expires on
        </ModalLabel>
        <input
          id="api-key-expiry"
          type="date"
          value={scope.expiresOn}
          min={moment().format("YYYY-MM-DD")}
          onChange={(e) => set({ expiresOn: e.target.value })}
          className={FIELD_CLASS}
        />
        <ModalHint>Leave empty for a key that never expires.</ModalHint>
      </div>
    </>
  );
}
