import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";

/** Settings page shell shared by the team list and team detail pages. */
export default function TeamsLayout({ title, description, action, children }) {
  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex md:mt-0 mt-6">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-2xl bg-zinc-900 light:bg-white light:border light:border-slate-300 w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-0 py-16 pb-16">
          <div className="flex items-end justify-between pr-8 py-6 border-b border-white/20 light:border-slate-300">
            <div className="flex flex-col gap-y-2">
              <div className="text-lg font-semibold leading-7 text-white light:text-slate-900">
                {title}
              </div>
              {description && (
                <p className="text-xs leading-4 text-zinc-400 light:text-slate-600 max-w-[700px]">
                  {description}
                </p>
              )}
            </div>
            {action}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PrimaryButton({ children, className = "", ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`border-none shrink-0 flex items-center justify-center h-9 px-5 py-2.5 rounded-lg bg-slate-50 text-zinc-950 text-sm font-medium leading-5 hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

export function RowButton({ children, danger = false, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`border-none text-xs font-medium text-white/80 light:text-black/80 rounded-lg px-2 py-1 hover:bg-white hover:bg-opacity-10 disabled:opacity-50 ${
        danger
          ? "hover:text-red-300 hover:light:text-red-500 hover:light:bg-red-50"
          : "hover:text-white hover:light:text-gray-500"
      }`}
    >
      {children}
    </button>
  );
}

export const SELECT_CLASS =
  "bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 text-sm rounded-[8px] outline-none h-8 px-3.5";
export const INPUT_CLASS =
  "bg-zinc-800 light:bg-white light:border light:border-slate-300 text-white light:text-slate-700 placeholder:text-zinc-400 light:placeholder:text-slate-400 text-sm rounded-[8px] outline-none h-8 px-3.5";
