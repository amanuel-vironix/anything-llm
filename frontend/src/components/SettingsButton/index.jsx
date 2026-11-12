import useUser from "@/hooks/useUser";
import useMyTeam from "@/hooks/useMyTeam";
import paths from "@/utils/paths";
import { ArrowUUpLeft, Wrench } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { useMatch } from "react-router-dom";

export default function SettingsButton() {
  const isInSettings = !!useMatch("/settings/*");
  const { user } = useUser();
  const { role: teamRole } = useMyTeam();
  // Default users only get settings when they lead a team (the Teams page).
  const isTeamLead = teamRole === "lead";

  if (user && user?.role === "default" && !isTeamLead) return null;
  const settingsHome =
    user?.role === "default"
      ? paths.settings.teams()
      : paths.settings.interface();

  if (isInSettings)
    return (
      <div className="flex w-fit">
        <Link
          to={paths.home()}
          className="transition-all duration-300 p-2 rounded-full bg-theme-sidebar-footer-icon hover:bg-theme-sidebar-footer-icon-hover"
          aria-label="Home"
          data-tooltip-id="footer-item"
          data-tooltip-content="Back to workspaces"
        >
          <ArrowUUpLeft
            className="h-5 w-5 text-white light:text-slate-800"
            weight="fill"
          />
        </Link>
      </div>
    );

  return (
    <div className="flex w-fit">
      <Link
        to={settingsHome}
        className="transition-all duration-300 p-2 rounded-full bg-theme-sidebar-footer-icon hover:bg-theme-sidebar-footer-icon-hover"
        aria-label="Settings"
        data-tooltip-id="footer-item"
        data-tooltip-content="Open settings"
      >
        <Wrench
          className="h-5 w-5 text-white light:text-slate-800"
          weight="fill"
        />
      </Link>
    </div>
  );
}
