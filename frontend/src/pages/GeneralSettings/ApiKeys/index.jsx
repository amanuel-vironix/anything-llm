import { useEffect, useState } from "react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import * as Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { PlusCircle, Warning } from "@phosphor-icons/react";
import moment from "moment";
import Workspace from "@/models/workspace";
import EditApiKeyModal from "./EditApiKeyModal";
import Admin from "@/models/admin";
import ApiKeyRow from "./ApiKeyRow";
import NewApiKeyModal from "./NewApiKeyModal";
import paths from "@/utils/paths";
import { userFromStorage } from "@/utils/request";
import System from "@/models/system";
import Modal from "@/components/lib/Modal";
import { useModal } from "@/hooks/useModal";
import CTAButton from "@/components/lib/CTAButton";
import { useTranslation } from "react-i18next";

export default function AdminApiKeys() {
  const { isOpen, openModal, closeModal } = useModal();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState([]);
  const [users, setUsers] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [editingKey, setEditingKey] = useState(null);
  const editModal = useModal();
  const multiUser = !!userFromStorage();

  const fetchExistingKeys = async () => {
    const Model = multiUser ? Admin : System;
    const { apiKeys: foundKeys } = await Model.getApiKeys();
    setApiKeys(foundKeys || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchExistingKeys();
    Workspace.all().then(setWorkspaces);
    if (multiUser) Admin.users().then((found) => setUsers(found || []));
  }, []);

  const openEdit = (apiKey) => {
    setEditingKey(apiKey);
    editModal.openModal();
  };

  // In multi-user mode a key with no owner is refused on every /v1 route.
  const ownerlessKeys = multiUser
    ? apiKeys.filter((apiKey) => !apiKey.user_id)
    : [];

  const removeApiKey = (id) => {
    setApiKeys((prevKeys) => prevKeys.filter((apiKey) => apiKey.id !== id));
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
                {t("api.title")}
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary mt-2">
              {t("api.description")}
            </p>
            <a
              href={paths.apiDocs()}
              target="_blank"
              rel="noreferrer"
              className="text-xs leading-[18px] font-base text-blue-300 light:text-blue-500 hover:underline mt-1"
            >
              {t("api.link")} &rarr;
            </a>
          </div>
          {ownerlessKeys.length > 0 && (
            <div className="mt-4 flex gap-x-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 light:text-amber-700 text-xs">
              <Warning size={18} className="shrink-0" />
              <div className="flex flex-col gap-y-2">
                <p className="font-semibold">
                  {ownerlessKeys.length} API key(s) have no owner and are
                  refused on every API route.
                </p>
                <p>
                  Each key now acts as its owner. Assign an owner to keep a key
                  working, or delete it.
                </p>
                <ul className="flex flex-col gap-y-1">
                  {ownerlessKeys.map((apiKey) => (
                    <li key={apiKey.id} className="flex items-center gap-x-3">
                      <span>
                        {apiKey.name || t("api.row.unnamed")} (created{" "}
                        {moment(apiKey.createdAt).format("ll")})
                      </span>
                      <button
                        type="button"
                        onClick={() => openEdit(apiKey)}
                        className="border-none underline hover:opacity-80"
                      >
                        Assign owner
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="w-full justify-end flex">
            <CTAButton
              onClick={openModal}
              className="mt-3 mr-0 mb-4 md:-mb-14 z-10"
            >
              <PlusCircle className="h-4 w-4" weight="bold" />{" "}
              {t("api.generate")}
            </CTAButton>
          </div>
          <div className="overflow-x-auto mt-6">
            {loading ? (
              <Skeleton.default
                height="80vh"
                width="100%"
                highlightColor="var(--theme-bg-primary)"
                baseColor="var(--theme-bg-secondary)"
                count={1}
                className="w-full p-4 rounded-b-2xl rounded-tr-2xl rounded-tl-sm"
                containerClassName="flex w-full"
              />
            ) : (
              <table className="w-full text-xs text-left rounded-lg min-w-[1040px] border-spacing-0 md:mt-6 mt-0">
                <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
                  <tr>
                    <th scope="col" className="px-6 py-3 rounded-tl-lg">
                      {t("api.table.name")}
                    </th>
                    <th scope="col" className="px-6 py-3">
                      {t("api.table.key")}
                    </th>
                    {multiUser && (
                      <th scope="col" className="px-6 py-3">
                        Owner
                      </th>
                    )}
                    <th scope="col" className="px-6 py-3">
                      Workspaces
                    </th>
                    <th scope="col" className="px-6 py-3">
                      Expires
                    </th>
                    <th scope="col" className="px-6 py-3">
                      Last used
                    </th>
                    <th scope="col" className="px-6 py-3">
                      {t("api.table.by")}
                    </th>
                    <th scope="col" className="px-6 py-3">
                      {t("api.table.created")}
                    </th>
                    <th scope="col" className="px-6 py-3 rounded-tr-lg">
                      {t("api.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.length === 0 ? (
                    <tr className="bg-transparent text-theme-text-secondary text-sm font-medium">
                      <td
                        colSpan={multiUser ? 9 : 8}
                        className="px-6 py-4 text-center"
                      >
                        {t("api.empty")}
                      </td>
                    </tr>
                  ) : (
                    apiKeys.map((apiKey) => (
                      <ApiKeyRow
                        key={apiKey.id}
                        apiKey={apiKey}
                        removeApiKey={removeApiKey}
                        multiUser={multiUser}
                        workspaces={workspaces}
                        onEdit={multiUser ? () => openEdit(apiKey) : null}
                      />
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <Modal isOpen={isOpen} onClose={closeModal}>
          <NewApiKeyModal
            closeModal={closeModal}
            onSuccess={fetchExistingKeys}
            users={users}
            workspaces={workspaces}
          />
        </Modal>
        <EditApiKeyModal
          isOpen={editModal.isOpen}
          closeModal={() => {
            editModal.closeModal();
            setEditingKey(null);
          }}
          onSuccess={fetchExistingKeys}
          apiKey={editingKey}
          users={users}
          workspaces={workspaces}
        />
      </div>
    </div>
  );
}
