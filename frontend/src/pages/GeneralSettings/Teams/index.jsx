import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { CircleNotch } from "@phosphor-icons/react";
import Team from "@/models/team";
import AccessPolicy from "@/models/accessPolicy";
import useUser from "@/hooks/useUser";
import useMyTeam, { refreshMyTeam } from "@/hooks/useMyTeam";
import { useModal } from "@/hooks/useModal";
import showToast from "@/utils/toast";
import paths from "@/utils/paths";
import TeamsLayout, { PrimaryButton, RowButton } from "./Layout";
import TeamModal from "./TeamModal";

/**
 * Admins see every team. A team lead is sent to their own team; anyone else is told
 * they have no team to manage. The server enforces all of this.
 */
export default function Teams() {
  const { user } = useUser();
  const myTeam = useMyTeam();
  const isAdmin = user?.role === "admin";

  if (!user)
    return (
      <TeamsLayout title="Teams">
        <p className="mt-8 text-sm text-zinc-400 light:text-slate-500">
          Teams are only available in multi-user mode.
        </p>
      </TeamsLayout>
    );

  if (isAdmin) return <AdminTeams />;

  if (myTeam.loading)
    return (
      <TeamsLayout title="Teams">
        <Loading />
      </TeamsLayout>
    );

  if (myTeam.role === "lead" && myTeam.team)
    return <Navigate to={paths.settings.team(myTeam.team.id)} replace />;

  return (
    <TeamsLayout title="Teams">
      <p className="mt-8 text-sm text-zinc-400 light:text-slate-500">
        {myTeam.team
          ? `You are a member of ${myTeam.team.name}. Only team leads and admins can manage a team.`
          : "You are not on a team."}
      </p>
    </TeamsLayout>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <CircleNotch className="h-8 w-8 text-zinc-400 animate-spin" />
    </div>
  );
}

function AdminTeams() {
  const navigate = useNavigate();
  const { isOpen, openModal, closeModal } = useModal();
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [editing, setEditing] = useState(null);

  const fetchTeams = async () => {
    const [_teams, _policies] = await Promise.all([
      Team.getAll(),
      AccessPolicy.getAll(),
    ]);
    setTeams(_teams);
    setPolicies(_policies);
    setLoading(false);
  };

  useEffect(() => {
    fetchTeams();
  }, []);

  const policyName = (id) =>
    id ? policies.find((p) => p.id === id)?.name || `#${id}` : "--";

  const handleDelete = async (team) => {
    const message =
      `Delete the team "${team.name}"?\n\n` +
      `Its ${team.memberCount || 0} member(s) leave the team and fall back to their own policy (or the role defaults). ` +
      `Its ${team.workspaceCount || 0} workspace(s) stay but become admin-only: members lose access through the team until you give them to another team or add users to them.\n` +
      `Team-shared slash commands go back to their owners, and the team's prompt variables are deleted.\n\n` +
      `This can't be undone.`;
    if (!window.confirm(message)) return;
    const { success, error } = await Team.delete(team.id);
    if (!success) {
      showToast(`Could not delete the team: ${error}`, "error");
      return;
    }
    refreshMyTeam();
    showToast("Team deleted.", "success");
    setTeams((prev) => prev.filter((t) => t.id !== team.id));
  };

  return (
    <TeamsLayout
      title="Teams"
      description="A team groups users, gives them a shared access policy and owns workspaces. Team leads can add members and manage the team's workspaces."
      action={
        <PrimaryButton
          onClick={() => {
            setEditing(null);
            openModal();
          }}
        >
          New team
        </PrimaryButton>
      }
    >
      {loading ? (
        <Loading />
      ) : teams.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-400 light:text-slate-500">
          No teams yet.
        </p>
      ) : (
        <div className="overflow-x-auto mt-6">
          <table className="w-full text-xs text-left rounded-lg min-w-[720px] border-spacing-0">
            <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Policy</th>
                <th className="px-6 py-3">Google Group</th>
                <th className="px-6 py-3">Members</th>
                <th className="px-6 py-3">Leads</th>
                <th className="px-6 py-3">Workspaces</th>
                <th className="px-6 py-3"> </th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr
                  key={team.id}
                  className="bg-transparent text-white light:text-slate-900 text-opacity-80 text-xs font-medium border-b border-white/10 h-10"
                >
                  <th scope="row" className="px-6 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => navigate(paths.settings.team(team.id))}
                      className="border-none hover:underline text-left"
                    >
                      {team.name}
                    </button>
                    {team.description && (
                      <p className="text-[11px] font-normal text-zinc-500 light:text-slate-500">
                        {team.description}
                      </p>
                    )}
                  </th>
                  <td className="px-6">{policyName(team.policy_id)}</td>
                  <td className="px-6">{team.idp_group || "--"}</td>
                  <td className="px-6">{team.memberCount || 0}</td>
                  <td className="px-6">{team.leadCount || 0}</td>
                  <td className="px-6">{team.workspaceCount || 0}</td>
                  <td className="px-6">
                    <div className="flex items-center gap-x-4">
                      <RowButton
                        onClick={() => navigate(paths.settings.team(team.id))}
                      >
                        Open
                      </RowButton>
                      <RowButton
                        onClick={() => {
                          setEditing(team);
                          openModal();
                        }}
                      >
                        Edit
                      </RowButton>
                      <RowButton danger onClick={() => handleDelete(team)}>
                        Delete
                      </RowButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TeamModal
        isOpen={isOpen}
        closeModal={() => {
          closeModal();
          setEditing(null);
        }}
        onSuccess={fetchTeams}
        team={editing}
        policies={policies}
      />
    </TeamsLayout>
  );
}
