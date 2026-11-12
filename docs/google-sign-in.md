# Google sign-in

AnythingLLM can sign people in with their Google Workspace account through
OpenID Connect. This guide sets it up for the `vironix.ai` Workspace. The same
code works with any OpenID provider by changing the issuer; only the `hd`
(Workspace domain) check is Google-specific.

## What is checked

A sign-in is accepted only when all of these hold:

- The ID token's signature verifies against Google's published keys, and its
  `iss`, `aud` (your client ID), `exp` and `nonce` are correct. The request also
  uses `state` and PKCE (S256).
- `email_verified` is `true`.
- The email's domain is in **Allowed domains**, exactly. Subdomains and
  look-alikes are refused.
- `hd` (the Google Workspace domain) is in **Allowed domains**. Consumer Google
  accounts have no `hd`, so a personal account registered with a work address
  is refused.
- The AnythingLLM account is not suspended.

Accounts are linked by the ID token's `sub`, never by email. A different Google
account that later gets the same email address can't take over an account.

Every refusal is written to the event log as `failed_login_oidc`, with the
reason. Successful sign-ins are logged as `login_event` with `method: "oidc"`.

## 1. Create the OAuth client in Google Cloud

Do this as a Google Workspace admin, or as someone with rights to create
projects in the Vironix organization.

1. In the [Google Cloud console](https://console.cloud.google.com/), select or
   create a project **inside the vironix.ai organization**.
2. Go to **APIs & Services → OAuth consent screen**:
   - **User type: Internal.** This lets only accounts in the Vironix Workspace
     organization sign in, so Google itself refuses everyone else before
     AnythingLLM sees them. AnythingLLM's own domain checks are a second layer.
   - App name: for example "AnythingLLM". Support email: a Vironix group
     address.
   - Scopes: `openid`, `email`, `profile`. These are non-sensitive and need no
     verification.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client
   ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs:** add exactly
     `https://<your AnythingLLM host>/api/auth/oidc/callback`, for example
     `https://llm.vironix.ai/api/auth/oidc/callback`. It must match the
     **Redirect URI** setting character for character.
   - You don't need **Authorized JavaScript origins**.
4. Copy the **Client ID** and **Client secret**.

## 2. Configure AnythingLLM

Google sign-in needs multi-user mode. Turn that on first under
**Settings → Security**.

Then, as an admin, open **Settings → Security → Google sign-in**:

| Setting | Value |
|---|---|
| Enable Google sign-in | on |
| Issuer | `https://accounts.google.com` |
| Client ID | from step 1 |
| Client secret | from step 1. It is stored encrypted, and the page shows it masked |
| Redirect URI | the same URI you registered in step 1 |
| Allowed domains | `vironix.ai` |
| New accounts | **Create on first sign-in** (default), or **Invite only** |
| Role for new accounts | **Default** (default) or **Manager**. Never admin |
| Turn off password sign-in | optional, see below |

**Save** validates every field before anything is written. If any field is
wrong, nothing is saved and the bad fields are marked.

### Environment variables

Each setting can instead come from an environment variable, which overrides
the stored value. The page then shows that field as read-only:

| Variable | Setting |
|---|---|
| `OIDC_ENABLED` | Enable Google sign-in (`true`/`false`) |
| `OIDC_ISSUER` | Issuer |
| `OIDC_CLIENT_ID` | Client ID |
| `OIDC_CLIENT_SECRET` | Client secret |
| `OIDC_REDIRECT_URI` | Redirect URI |
| `OIDC_ALLOWED_DOMAINS` | Allowed domains (comma-separated) |
| `OIDC_PROVISIONING` | `auto` or `invite_only` |
| `OIDC_DEFAULT_ROLE` | `default` or `manager` |
| `OIDC_ONLY` | Turn off password sign-in (`true`/`false`) |

Two more settings are environment-only:

| Variable | Default | Meaning |
|---|---|---|
| `OIDC_SESSION_EXPIRY` | `12h` | How long a session started with Google lasts. After this, the user signs in with Google again, so disabling someone's Google account ends their access within this time. Password sessions keep `JWT_EXPIRY` (30 days by default). |
| `OIDC_APP_URL` | origin of the redirect URI | Where the browser goes after sign-in. Set this only when the frontend is served from a different origin than the API, as in local development (`http://localhost:3000`). |

The post-sign-in address always comes from configuration, never from request
headers, so a forged `Host` header can't redirect a login.

## How new accounts are created

- **Create on first sign-in** (`auto`): the first time a verified `@vironix.ai`
  Workspace account signs in, a user is created with the configured role. The
  username is the email address, for example `jane@vironix.ai`. If that name is
  taken, it becomes `jane.2@vironix.ai`. The account gets a random password
  nobody knows. Admins adjust roles and workspaces afterwards on the Users page.
- **Invite only** (`invite_only`): a Google account with no linked user is
  refused. To let someone in, create an invite under **Settings → Invites** and
  send them the link. On the invite page they choose **Sign in with Google**.
  The invite is used up atomically, so one invite creates at most one account.

An existing password account is **not** linked to a Google account with the
same email. Signing in with Google creates a separate account, named
`<email>.2` if the email is already a username. Linking an existing account to
Google from the account menu is not built yet.

The Users page shows the Google account linked to each user.

## Turning off password sign-in

With **Turn off password sign-in** on, password sign-in works **for admins
only**. Everyone else must use Google, and new password invites are refused.
Admins keep their password and recovery codes as a break-glass path if Google
sign-in breaks or is misconfigured.

Before you turn this on:

- Make sure at least one admin has a password they can use, and has saved their
  recovery codes.
- AnythingLLM refuses to suspend, demote or delete the last active admin, so
  this fallback can't be removed by accident.

Password sign-in can only be turned off while Google sign-in is on. Turning
Google sign-in off restores password sign-in for everyone.

## Troubleshooting

The login page shows the reason for a refused sign-in. Details, such as the
exact token check that failed, are in the event log under `failed_login_oidc`.

| Shown | Likely cause |
|---|---|
| The sign-in request expired | More than 10 minutes on Google's screen, the sign-in started on a different host, or cookies are blocked |
| Could not be verified | The client ID or secret is wrong, the issuer is wrong, or the server clock is off |
| Not in an allowed domain / Workspace account | The account is outside `vironix.ai`, or is a consumer Google account |
| No account exists | Invite-only mode, and no invite was used |
| `redirect_uri_mismatch` on Google's page | The redirect URI in Google Cloud doesn't exactly match the setting |
