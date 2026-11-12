import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { titleCase } from "text-case";
import { CircleNotch, CaretLeft } from "@phosphor-icons/react";
import Team from "@/models/team";
import Admin from "@/models/admin";
import { refreshMyTeam } from "@/hooks/useMyTeam";
import { useModal } from "@/hooks/useModal";
import showToast from "@/utils/toast";
import paths from "@/utils/paths";
import TeamsLayout, {
  PrimaryButton,
  RowButton,
  SELECT_CLASS,
  INPUT_CLASS,
} from "../Layout";
import TeamWorkspaceModal from "../TeamWorkspaceModal";

/** Members and workspaces of one team, for its leads and for admins. */
export default function TeamDetail() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState({
    team: null,
    policy: null,
    teamRole: null,
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      const res = await Team.get(id);
      if (!res?.team) setError(res?.error || "You can't manage this team.");
      setInfo(res);
      setLoading(false);
    }
    load();
  }, [id]);

  const isAdmin = info.teamRole === "admin";

  return (
    <TeamsLayout
      title={
        <div className="flex items-center gap-x-2">
          {isAdmin && (
            <Link
              to={paths.settings.teams()}
              aria-label="Back to teams"
              className="text-zinc-400 hover:text-white light:hover:text-slate-900"
            >
              <CaretLeft size={18} weight="bold" />
            </Link>
          )}
          <span>{info.team?.name || "Team"}</span>
        </div>
      }
      description={
        info.team
          ? [
              info.team.description,
              `Access policy: ${info.policy?.name || "none"}.`,
              isAdmin ? null : "You are a lead of this team.",
            ]
              .filter(Boolean)
              .join(" ")
          : null
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <CircleNotch className="h-8 w-8 text-zinc-400 animate-spin" />
        </div>
      ) : error ? (
        <p className="mt-8 text-sm text-red-400 light:text-red-600">{error}</p>
      ) : (
        <>
          <Members teamId={info.team.id} isAdmin={isAdmin} />
          <Workspaces teamId={info.team.id} isAdmin={isAdmin} />
        </>
      )}
    </TeamsLayout>
  );
}

function SectionTitle({ title, description }) {
  return (
    <div className="mt-8 flex flex-col gap-y-1 pb-3 border-b border-white/20 light:border-slate-300">
      <p className="text-base font-semibold leading-6 text-white light:text-slate-900">
        {title}
      </p>
      {description && (
        <p className="text-xs leading-4 text-zinc-400 light:text-slate-600 max-w-[700px]">
          {description}
        </p>
      )}
    </div>
  );
}

function Members({ teamId, isAdmin }) {
  const [members, setMembers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [_members, _candidates] = await Promise.all([
      Team.members(teamId),
      Team.candidates(teamId),
    ]);
    setMembers(_members);
    setCandidates(_candidates);
  };

  useEffect(() => {
    load();
  }, [teamId]);

  const addMember = async () => {
    if (!newUserId) return;
    setBusy(true);
    const { member, error } = await Team.addMember(
      teamId,
      Number(newUserId),
      newRole
    );
    setBusy(false);
    if (!member) {
      showToast(`Could not add the user: ${error}`, "error");
      return;
    }
    setNewUserId("");
    setNewRole("member");
    await load();
  };

  const removeMember = async (member) => {
    if (
      !window.confirm(
        `Remove ${member.user?.username} from the team? They lose access to the team's workspaces.`
      )
    )
      return;
    const { success, error } = await Team.removeMember(teamId, member.userId);
    if (!success) {
      showToast(error || "Could not remove the member.", "error");
      return;
    }
    refreshMyTeam();
    await load();
  };

  const setRole = async (member, role) => {
    const { success, error } = await Team.setMemberRole(
      teamId,
      member.userId,
      role
    );
    if (!success) {
      showToast(error || "Could not change the role.", "error");
      return;
    }
    refreshMyTeam();
    await load();
  };

  return (
    <>
      <SectionTitle
        title="Members"
        description={
          isAdmin
            ? "Add any user who isn't on another team. Leads can add members and manage the team's workspaces."
            : "You can add active default-role users who aren't on another team."
        }
      />
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <select
          value={newUserId}
          onChange={(e) => setNewUserId(e.target.value)}
          className={`${SELECT_CLASS} min-w-[220px]`}
          aria-label="User to add"
        >
          <option value="">
            {candidates.length ? "Add an existing user..." : "No users to add"}
          </option>
          {candidates.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username} ({user.role})
            </option>
          ))}
        </select>
        <select
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
          className={SELECT_CLASS}
          aria-label="Team role"
        >
          <option value="member">Member</option>
          <option value="lead">Lead</option>
        </select>
        <PrimaryButton onClick={addMember} disabled={!newUserId || busy}>
          Add
        </PrimaryButton>
      </div>
      <div className="overflow-x-auto mt-4">
        <table className="w-full text-xs text-left rounded-lg min-w-[560px] border-spacing-0">
          <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
            <tr>
              <th className="px-6 py-3">Username</th>
              <th className="px-6 py-3">System role</th>
              <th className="px-6 py-3">Team role</th>
              <th className="px-6 py-3"> </th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-6 py-4 text-center text-sm text-theme-text-secondary"
                >
                  No members yet.
                </td>
              </tr>
            )}
            {members.map((member) => (
              <tr
                key={member.userId}
                className="bg-transparent text-white light:text-slate-900 text-opacity-80 text-xs font-medium border-b border-white/10 h-10"
              >
                <th scope="row" className="px-6 whitespace-nowrap">
                  {member.user?.username || `User #${member.userId}`}
                  {!!member.user?.suspended && (
                    <span className="ml-2 text-[10px] text-orange-400">
                      suspended
                    </span>
                  )}
                </th>
                <td className="px-6">{titleCase(member.user?.role || "")}</td>
                <td className="px-6">{titleCase(member.role || "")}</td>
                <td className="px-6">
                  <div className="flex items-center gap-x-4">
                    {member.role === "lead" ? (
                      <RowButton onClick={() => setRole(member, "member")}>
                        Make member
                      </RowButton>
                    ) : (
                      <RowButton onClick={() => setRole(member, "lead")}>
                        Make lead
                      </RowButton>
                    )}
                    <RowButton danger onClick={() => removeMember(member)}>
                      Remove
                    </RowButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Workspaces({ teamId, isAdmin }) {
  const { isOpen, openModal, closeModal } = useModal();
  const [workspaces, setWorkspaces] = useState([]);
  const [allWorkspaces, setAllWorkspaces] = useState([]);
  const [newName, setNewName] = useState("");
  const [attachSlug, setAttachSlug] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [_workspaces, _all] = await Promise.all([
      Team.workspaces(teamId),
      isAdmin ? Admin.workspaces() : Promise.resolve([]),
    ]);
    setWorkspaces(_workspaces);
    setAllWorkspaces(_all || []);
  };

  useEffect(() => {
    load();
  }, [teamId, isAdmin]);

  const createWorkspace = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    const { workspace, error } = await Team.createWorkspace(
      teamId,
      newName.trim()
    );
    setBusy(false);
    if (!workspace) {
      showToast(`Could not create the workspace: ${error}`, "error");
      return;
    }
    setNewName("");
    await load();
  };

  const attach = async () => {
    if (!attachSlug) return;
    const target = allWorkspaces.find((ws) => ws.slug === attachSlug);
    if (
      target?.team_id &&
      !window.confirm(
        `${target.name} belongs to another team. Move it to this team?`
      )
    )
      return;
    const { workspace, error } = await Team.setWorkspaceTeam(
      attachSlug,
      teamId
    );
    if (!workspace) {
      showToast(`Could not add the workspace: ${error}`, "error");
      return;
    }
    setAttachSlug("");
    await load();
  };

  const detach = async (workspace) => {
    if (
      !window.confirm(
        `Detach ${workspace.name} from this team? Team members lose access through the team; the workspace becomes admin-only unless users are added to it directly.`
      )
    )
      return;
    const { workspace: updated, error } = await Team.setWorkspaceTeam(
      workspace.slug,
      null
    );
    if (!updated) {
      showToast(`Could not detach the workspace: ${error}`, "error");
      return;
    }
    await load();
  };

  const attachable = allWorkspaces.filter((ws) => ws.team_id !== teamId);

  return (
    <>
      <SectionTitle
        title="Workspaces"
        description="Every team member can chat in the team's workspaces. Leads can change the settings below; the model is set by an admin."
      />
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createWorkspace()}
          placeholder="New team workspace name"
          className={`${INPUT_CLASS} min-w-[220px]`}
        />
        <PrimaryButton
          onClick={createWorkspace}
          disabled={!newName.trim() || busy}
        >
          New team workspace
        </PrimaryButton>
      </div>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <select
            value={attachSlug}
            onChange={(e) => setAttachSlug(e.target.value)}
            className={`${SELECT_CLASS} min-w-[220px]`}
            aria-label="Workspace to add"
          >
            <option value="">Add an existing workspace to this team...</option>
            {attachable.map((ws) => (
              <option key={ws.slug} value={ws.slug}>
                {ws.name}
                {ws.team_id ? " (on another team)" : ""}
              </option>
            ))}
          </select>
          <PrimaryButton onClick={attach} disabled={!attachSlug}>
            Add to team
          </PrimaryButton>
        </div>
      )}
      <div className="overflow-x-auto mt-4">
        <table className="w-full text-xs text-left rounded-lg min-w-[560px] border-spacing-0">
          <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
            <tr>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Chat mode</th>
              <th className="px-6 py-3"> </th>
            </tr>
          </thead>
          <tbody>
            {workspaces.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-6 py-4 text-center text-sm text-theme-text-secondary"
                >
                  This team has no workspaces yet.
                </td>
              </tr>
            )}
            {workspaces.map((workspace) => (
              <tr
                key={workspace.id}
                className="bg-transparent text-white light:text-slate-900 text-opacity-80 text-xs font-medium border-b border-white/10 h-10"
              >
                <th scope="row" className="px-6 whitespace-nowrap">
                  <Link
                    to={paths.workspace.chat(workspace.slug)}
                    className="hover:underline"
                  >
                    {workspace.name}
                  </Link>
                </th>
                <td className="px-6">
                  {titleCase(workspace.chatMode || "chat")}
                </td>
                <td className="px-6">
                  <div className="flex items-center gap-x-4">
                    <RowButton
                      onClick={() => {
                        setEditing(workspace);
                        openModal();
                      }}
                    >
                      Settings
                    </RowButton>
                    {isAdmin && (
                      <RowButton danger onClick={() => detach(workspace)}>
                        Detach
                      </RowButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TeamWorkspaceModal
        isOpen={isOpen}
        closeModal={() => {
          closeModal();
          setEditing(null);
        }}
        onSuccess={load}
        teamId={teamId}
        workspace={editing}
      />
    </>
  );
}
