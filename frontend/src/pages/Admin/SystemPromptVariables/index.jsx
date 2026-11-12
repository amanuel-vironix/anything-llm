import React, { useState, useEffect } from "react";
import System from "@/models/system";
import showToast from "@/utils/toast";
import { Plus } from "@phosphor-icons/react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import CTAButton from "@/components/lib/CTAButton";
import VariableRow from "./VariableRow";
import Modal from "@/components/lib/Modal";
import AddVariableModal from "./AddVariableModal";
import { useModal } from "@/hooks/useModal";
import * as Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import useUser from "@/hooks/useUser";
import useMyTeam from "@/hooks/useMyTeam";
import Team from "@/models/team";

export default function SystemPromptVariables() {
  const [variables, setVariables] = useState([]);
  const [loading, setLoading] = useState(true);
  const { isOpen, openModal, closeModal } = useModal();
  const { user } = useUser();
  const { team: myTeam, role: myTeamRole } = useMyTeam();
  const [teams, setTeams] = useState([]);
  // Single-user mode has no user and full access.
  const isAdmin = !user || user.role === "admin";
  const leadOfTeam = myTeamRole === "lead" ? myTeam : null;
  const canCreate = isAdmin || !!leadOfTeam;

  useEffect(() => {
    fetchVariables();
    if (user?.role === "admin") Team.getAll().then(setTeams);
  }, []);

  const teamLabel = (teamId) => {
    if (!teamId) return null;
    if (myTeam?.id === teamId) return myTeam.name;
    return teams.find((team) => team.id === teamId)?.name || `Team #${teamId}`;
  };
  // Admins manage every variable; a lead manages their own team's.
  const canManage = (variable) =>
    isAdmin || (!!leadOfTeam && variable.teamId === leadOfTeam.id);

  const fetchVariables = async () => {
    setLoading(true);
    try {
      const { variables } = await System.promptVariables.getAll();
      setVariables(variables || []);
    } catch (error) {
      console.error("Error fetching variables:", error);
      showToast("No variables found", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-zinc-900 light:bg-white w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
          <div className="w-full flex flex-col gap-y-1 pb-6 border-white/10 border-b-2">
            <div className="items-center flex gap-x-4">
              <p className="text-lg leading-6 font-bold text-theme-text-primary">
                System Prompt Variables
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary">
              System prompt variables are used to store configuration values
              that can be referenced in your system prompt to enable dynamic
              content in your prompts.
            </p>
          </div>

          <div className="w-full justify-end flex">
            {canCreate && (
              <CTAButton
                onClick={openModal}
                className="mt-3 mr-0 mb-4 md:-mb-6 z-10"
              >
                <Plus className="h-4 w-4" weight="bold" /> Add Variable
              </CTAButton>
            )}
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <Skeleton.default
                height="80vh"
                width="100%"
                highlightColor="var(--theme-bg-primary)"
                baseColor="var(--theme-bg-secondary)"
                count={1}
                className="w-full p-4 rounded-b-2xl rounded-tr-2xl rounded-tl-sm mt-8"
                containerClassName="flex w-full"
              />
            ) : variables.length === 0 ? (
              <div className="text-center py-4 text-theme-text-secondary">
                No variables found
              </div>
            ) : (
              <table className="w-full text-sm text-left rounded-lg min-w-[640px] border-spacing-0">
                <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
                  <tr>
                    <th scope="col" className="px-4 py-2 rounded-tl-lg">
                      Key
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Value
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Description
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Type
                    </th>
                    {!!user && (
                      <th scope="col" className="px-4 py-2">
                        Visible to
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {variables.map((variable) => (
                    <VariableRow
                      key={variable.id}
                      variable={variable}
                      onRefresh={fetchVariables}
                      showVisibility={!!user}
                      teamName={teamLabel(variable.teamId)}
                      canManage={canManage(variable)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <Modal isOpen={isOpen} onClose={closeModal}>
        <AddVariableModal
          closeModal={closeModal}
          onRefresh={fetchVariables}
          isAdmin={isAdmin}
          teams={teams}
          leadOfTeam={leadOfTeam}
        />
      </Modal>
    </div>
  );
}
