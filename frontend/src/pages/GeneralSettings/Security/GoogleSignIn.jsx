import { useEffect, useState } from "react";
import Admin from "@/models/admin";
import showToast from "@/utils/toast";
import CTAButton from "@/components/lib/CTAButton";
import Toggle from "@/components/lib/Toggle";
import { API_BASE } from "@/utils/constants";

const INPUT_CLASS =
  "border-none bg-theme-settings-input-bg text-white text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5 placeholder:text-theme-settings-input-placeholder focus:ring-blue-500 disabled:opacity-60";

/** The callback address on this server, suggested when none is set. */
function suggestedRedirectUri() {
  const base = API_BASE.startsWith("http")
    ? API_BASE
    : `${window.location.origin}${API_BASE}`;
  return `${base}/auth/oidc/callback`;
}

/**
 * Google (OIDC) sign-in settings on the Security page. Admin only: the server
 * refuses everyone else and this renders nothing for them. The server
 * validates the whole configuration and saves it all at once or not at all;
 * field errors come back keyed by field.
 */
export default function GoogleSignIn() {
  const [settings, setSettings] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    Admin.oidcSettings().then((result) => {
      if (!result) return;
      setSettings({
        ...result,
        allowedDomains: (result.allowedDomains || []).join(", "),
        redirectUri: result.redirectUri || suggestedRedirectUri(),
      });
      // A configuration that is not valid (for example one set only by
      // environment variables) is not in force; show why.
      setErrors(result.configErrors || {});
    });
  }, []);

  if (!settings) return null;
  const locked = (field) => settings.envOverrides?.includes(field);
  const update = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const {
      envOverrides: _envOverrides,
      configErrors: _configErrors,
      ...payload
    } = settings;
    const { success, errors } = await Admin.updateOidcSettings(payload);
    setSaving(false);
    setErrors(errors || {});
    if (success) {
      setHasChanges(false);
      showToast("Google sign-in settings saved.", "success", { clear: true });
    } else {
      showToast("Nothing was saved. Fix the fields marked below.", "error", {
        clear: true,
      });
    }
  };

  const textField = (
    field,
    label,
    { placeholder, type = "text", hint } = {}
  ) => (
    <div className="w-96">
      <label
        htmlFor={`oidc-${field}`}
        className="text-white text-sm font-semibold block mb-2"
      >
        {label}
      </label>
      <input
        id={`oidc-${field}`}
        type={type}
        className={INPUT_CLASS}
        placeholder={placeholder}
        value={settings[field] ?? ""}
        disabled={locked(field)}
        autoComplete="off"
        onChange={(e) => update(field, e.target.value)}
      />
      {locked(field) && (
        <p className="text-white text-opacity-60 text-xs mt-1">
          Set by an environment variable.
        </p>
      )}
      {hint && !locked(field) && (
        <p className="text-white text-opacity-60 text-xs mt-1">{hint}</p>
      )}
      {errors[field] && (
        <p className="text-red-400 text-xs mt-1" role="alert">
          {errors[field]}
        </p>
      )}
    </div>
  );

  const selectField = (field, label, options) => (
    <div className="w-96">
      <label
        htmlFor={`oidc-${field}`}
        className="text-white text-sm font-semibold block mb-2"
      >
        {label}
      </label>
      <select
        id={`oidc-${field}`}
        className={INPUT_CLASS}
        value={settings[field]}
        disabled={locked(field)}
        onChange={(e) => update(field, e.target.value)}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {errors[field] && (
        <p className="text-red-400 text-xs mt-1" role="alert">
          {errors[field]}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px]">
      <div className="w-full flex flex-col gap-y-1 pb-6 border-white light:border-theme-sidebar-border border-b-2 border-opacity-10">
        <div className="w-full flex flex-col gap-y-1">
          <p className="text-base font-bold text-white mt-6">Google sign-in</p>
          <p className="text-xs leading-[18px] font-base text-white text-opacity-60">
            Let people sign in with their Google Workspace account. Only
            verified accounts in the allowed domains can sign in. See
            docs/google-sign-in.md for setting up the Google Cloud OAuth client.
          </p>
        </div>
        {hasChanges && (
          <div className="flex justify-end">
            <CTAButton onClick={handleSave} className="mt-3 mr-0 -mb-14 z-10">
              {saving ? "Saving..." : "Save"}
            </CTAButton>
          </div>
        )}
        <div className="flex flex-col gap-y-4 mt-6">
          <Toggle
            size="lg"
            label="Enable Google sign-in"
            enabled={!!settings.enabled}
            disabled={locked("enabled")}
            onChange={(checked) => update("enabled", checked)}
          />
          {errors.enabled && (
            <p className="text-red-400 text-xs" role="alert">
              {errors.enabled}
            </p>
          )}
          {textField("issuer", "Issuer", {
            placeholder: "https://accounts.google.com",
          })}
          {textField("clientId", "Client ID", {
            placeholder: "1234-abc.apps.googleusercontent.com",
          })}
          {textField("clientSecret", "Client secret", {
            type: "password",
            hint: "Stored encrypted. Leave as is to keep the saved secret.",
          })}
          {textField("redirectUri", "Redirect URI", {
            hint: "Add exactly this address to the OAuth client in Google Cloud.",
          })}
          {textField("allowedDomains", "Allowed domains", {
            placeholder: "vironix.ai",
            hint: "Comma-separated. Checked against the account's email and its Workspace domain.",
          })}
          {selectField("provisioning", "New accounts", [
            ["auto", "Create on first sign-in"],
            ["invite_only", "Invite only"],
          ])}
          {selectField("defaultRole", "Role for new accounts", [
            ["default", "Default"],
            ["manager", "Manager"],
          ])}
          <Toggle
            size="lg"
            label="Turn off password sign-in (admins keep it)"
            enabled={!!settings.passwordLoginDisabled}
            disabled={locked("passwordLoginDisabled")}
            onChange={(checked) => update("passwordLoginDisabled", checked)}
          />
          {errors.passwordLoginDisabled && (
            <p className="text-red-400 text-xs" role="alert">
              {errors.passwordLoginDisabled}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
