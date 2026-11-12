import React, { useEffect, useState } from "react";
import System from "@/models/system";
import { API_BASE } from "@/utils/constants";

// Messages for the `sso_error` codes the server's callback sends back
// (REFUSALS in server/utils/auth/oidc.js).
const SIGN_IN_ERRORS = {
  disabled: "Google sign-in is not enabled.",
  state_invalid: "The sign-in request expired. Try again.",
  provider_error: "Google did not complete the sign-in.",
  token_invalid: "The sign-in response from Google could not be verified.",
  email_unverified: "Your Google account's email address is not verified.",
  domain_not_allowed: "This Google account is not in an allowed domain.",
  hd_not_allowed: "Sign in with your organization's Google Workspace account.",
  not_invited:
    "No account exists for this Google account. Ask an admin for an invite.",
  suspended: "This account is suspended.",
  account_error: "Your account could not be set up. Contact an admin.",
};

/**
 * "Sign in with Google" for the multi-user login form and the invite page.
 * Renders nothing unless Google sign-in is enabled on the server.
 * @param {{inviteCode?: string}} props - carried through sign-in for
 *   invite-only provisioning
 */
export default function GoogleSignInButton({ inviteCode = null }) {
  const [settings, setSettings] = useState(null);
  const errorCode = new URLSearchParams(window.location.search).get(
    "sso_error"
  );

  useEffect(() => {
    System.keys()
      .then((keys) =>
        setSettings({
          enabled: !!keys?.OidcEnabled,
          passwordOff: !!keys?.OidcPasswordLoginDisabled,
        })
      )
      .catch(() => setSettings({ enabled: false, passwordOff: false }));
  }, []);

  if (!settings?.enabled) return null;
  const href = `${API_BASE}/auth/oidc/start${
    inviteCode ? `?invite=${encodeURIComponent(inviteCode)}` : ""
  }`;

  return (
    <div className="w-full flex flex-col items-center gap-y-3">
      <a
        href={href}
        className="flex items-center justify-center text-zinc-950 bg-white hover:bg-zinc-300 light:bg-sky-200 light:text-slate-950 light:hover:bg-sky-300 text-sm font-semibold rounded-lg border-primary-button h-[34px] w-full"
      >
        Sign in with Google
      </a>
      {errorCode && (
        <p className="text-red-400 text-sm text-center" role="alert">
          {SIGN_IN_ERRORS[errorCode] || "Google sign-in failed."}
        </p>
      )}
      {settings.passwordOff && !inviteCode && (
        <p className="text-zinc-400 light:text-zinc-600 text-xs text-center">
          Password sign-in is for administrators only.
        </p>
      )}
    </div>
  );
}
