// Route audit declarations for the routes added by the access-policy (AP) and
// Google sign-in (GS) branches, declared after both merged (see ./index.js and
// docs/merge-coordination.md). Their handlers still call EventLogs.logEvent;
// server/utils/audit/legacy.js maps each name to a catalogue action.

module.exports = {
  // server/endpoints/accessPolicies.js (mounted from admin.js)
  "POST /admin/access-policies/new": { legacy: ["policy_created"] },
  "POST /admin/access-policies/:id": { legacy: ["policy_updated"] },
  "DELETE /admin/access-policies/:id": { legacy: ["policy_deleted"] },
  "POST /admin/users/:id/policy": { legacy: ["policy_assigned"] },
  "POST /admin/agent-tool-role-policy": { legacy: ["role_default_updated"] },
  "POST /admin/agent-tool-sharing": { legacy: ["policy_updated"] },

  // server/endpoints/teams.js (mounted from admin.js)
  "POST /admin/teams/new": { legacy: ["team_created"] },
  "POST /admin/teams/:teamId": { legacy: ["team_updated"] },
  "DELETE /admin/teams/:teamId": { legacy: ["team_deleted"] },
  "POST /admin/workspaces/:slug/team": { legacy: ["workspace_team_changed"] },
  "POST /teams/:teamId/members": { legacy: ["team_member_added"] },
  "DELETE /teams/:teamId/members/:userId": { legacy: ["team_member_removed"] },
  "POST /teams/:teamId/members/:userId/role": {
    legacy: ["team_lead_changed"],
  },
  "POST /teams/:teamId/workspaces/new": { legacy: ["team_workspace_created"] },
  "POST /teams/:teamId/workspaces/:slug/update": {
    legacy: ["team_workspace_updated"],
  },

  // server/endpoints/admin.js
  "POST /admin/api-keys/:id": { legacy: ["api_key_updated"] },

  // server/endpoints/auth/oidc.js. The callback is a GET that creates users,
  // links identities and issues login tokens.
  "GET /auth/oidc/callback": {
    legacy: ["login_event", "failed_login_oidc", "user_created_oidc"],
  },
  "POST /admin/oidc-settings": { legacy: ["oidc_settings_updated"] },
};
