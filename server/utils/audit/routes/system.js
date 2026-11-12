// Route audit declarations: see ./index.js.
// server/endpoints/system.js, except the routes GS (login, multi-user) and AP
// (API keys, presets, prompt variables) are editing; those stay in ./held.js.

// settings.changed is recorded by SystemSettings._updateSettings.
const SETTING = {
  actions: ["settings.changed"],
  in: ["models/systemSettings.js"],
};

module.exports = {
  "POST /onboarding": SETTING,
  "POST /system/recover-account": { actions: ["auth.recovery_used"] },
  "POST /system/reset-password": { actions: ["auth.password_reset"] },
  "DELETE /system/remove-document": { actions: ["document.deleted"] },
  "DELETE /system/remove-documents": { actions: ["document.deleted"] },
  "DELETE /system/remove-folder": { actions: ["document.deleted"] },
  "POST /system/update-password": { actions: ["auth.password_changed"] },
  "POST /system/upload-pfp": { actions: ["user.updated"] },
  "DELETE /system/remove-pfp": { actions: ["user.updated"] },
  "POST /system/default-system-prompt": SETTING,
  "POST /system/upload-logo": SETTING,
  // A GET that writes: it resets the logo to the default.
  "GET /system/remove-logo": SETTING,
  "POST /system/event-logs": { actions: ["audit.viewed"] },
  "POST /system/workspace-chats": { actions: ["chat.viewed_other_user"] },
  "DELETE /system/workspace-chats/:id": {
    actions: ["chat.deleted", "chat.bulk_deleted"],
  },
  "GET /system/export-chats": { actions: ["chat.exported"] },
  "POST /system/user": { actions: ["user.updated", "auth.password_changed"] },
};
