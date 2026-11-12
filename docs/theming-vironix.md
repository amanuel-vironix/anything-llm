# Vironix theme tokens

Design tokens for restyling this AnythingLLM fork to match <https://www.vironix.ai/>.
They were read on 2026-11-11 from the site's inline `:root` / `.dark` custom properties
(`--aw-color-*`, an AstroWind-based Astro site) and its compiled stylesheet
(`/_astro/Layout.*.css`). Values marked *inferred* are not in the site's CSS.

## Colour

The site defines both a light set (`:root`) and a dark set (`.dark`).

| Token | Light | Dark | Site variable |
| --- | --- | --- | --- |
| Page background (canvas) | `#FBFAF8` rgb(251 250 248) | `#101B2B` rgb(16 27 43) | `--aw-color-canvas` |
| Surface (cards, panels) | `#FFFFFF` | `#16263A` rgb(22 38 58) | `--aw-color-surface` |
| Surface, muted | `#F2F4F7` rgb(242 244 247) | `#1B2C42` rgb(27 44 66) | `--aw-color-surface-muted` |
| Inverse surface (dark bands) | `#132033` rgb(19 32 51) | `#0B1421` rgb(11 20 33) | `--aw-color-inverse-surface` |
| Text (ink) | `#1D2632` rgb(29 38 50) | `#F4F6F9` rgb(244 246 249) | `--aw-color-ink` |
| Text, muted | `#48566A` rgb(72 86 106) | ink at 72% | `--aw-color-ink-muted` |
| Text, subtle | `#5F6B7D` rgb(95 107 125) | ink at 58% | `--aw-color-ink-subtle` |
| Text, faint (decorative only) | `#8B95A5` | ink at 42% | `--aw-color-ink-faint` |
| Primary (brand blue) | `#046DDB` rgb(4 109 219) | `#8FB4FF` rgb(143 180 255) | `--aw-color-primary` |
| Primary hover | `#0458B0` rgb(4 88 176) | `#B9D0FF` rgb(185 208 255) | `--aw-color-primary-hover` |
| Primary tint (selected bg) | primary at 9% | primary at 14% | `--aw-color-primary-tint` |
| Text on primary | `#FFFFFF` | `#0B1421` | `--aw-color-on-primary` |
| Hairline border | ink at 8% | ink at 16% | `--aw-color-hairline` |
| Hairline border, strong | ink at 14% | ink at 24% | `--aw-color-hairline-strong` |
| Overlay shadow | `0 18px 44px -18px rgb(19 32 51 / 35%)` | same, `rgb(0 0 0 / 60%)` | `--aw-shadow-overlay` |

Accent and secondary are aliases of primary and primary-hover on the site; there is no
second hue. The logo adds a blue gradient (about `#0A7AF0` → `#2C4DB8`, *inferred* from the
PNG) and a deep navy wordmark (about `#03026A`, *inferred*).

## Type

| Role | Family | Weights | Source |
| --- | --- | --- | --- |
| Body / UI | Libre Franklin (variable) | 100–900; UI uses 400/500/600 | Self-hosted fontsource woff2 (`/_astro/libre-franklin-*-wght-normal.*.woff2`), SIL OFL 1.1 |
| Headings / display | Newsreader (variable, serif) | 200–800 | Self-hosted fontsource woff2, SIL OFL 1.1 |

The fork self-hosts the Libre Franklin latin and latin-ext subsets in
`frontend/public/fonts/` so the gateway never calls a third-party font CDN. Newsreader
is not applied in the app: AnythingLLM has almost no display headings, and a serif in
dense settings tables reads poorly. It can be added later for the login headline.

## Shape

| Token | Value | Use on the site |
| --- | --- | --- |
| `radius-md` | 0.375rem (6px) | small controls |
| `radius-lg` | 0.5rem (8px) | buttons (`.btn`, `.btn-primary`) |
| `radius-xl` | 0.75rem (12px) | images, cards |
| `radius-2xl` | 1rem (16px) | large cards |
| pill | `9999px` | filter chips |

AnythingLLM already uses `rounded-lg` for buttons and inputs, so no radius change is needed.

## Components

- **Primary button:** background primary, 1px border primary, text on-primary, 15px
  semibold, padding 14px × 24px, radius 8px, 200ms colour transition; hover switches
  background and border to primary-hover. Focus: 2px outline in primary, offset 2px.
- **Secondary button:** transparent, 1px hairline-strong border, ink text; hover turns
  border and text primary.
- **Tertiary button:** like secondary with no border and ink-muted text.
- **Inputs:** the site has no styled form fields on the home page, only the Tailwind
  reset (inherit font, transparent background). The app keeps its own inputs, recoloured
  through the palette.
- **Feel:** warm off-white canvas, white cards, navy ink and one confident blue. Dark
  sections are deep navy (`#101B2B` to `#132033`) with a soft periwinkle accent. Thin
  hairline borders and plenty of whitespace.

## Logo

- Primary logo: `https://www.vironix.ai/_astro/Vironix_Logo_Primary_300.CFX8xheF.png`
  (2401 × 901 RGBA PNG on transparent). It shows a "V" mark (blue gradient leaf plus navy
  stroke) and the wordmark "vironix health" in navy.
- Favicon / touch icon: `/_astro/favicon-32x32.*.png` and `/_astro/apple-touch-icon.*.png`
  (192 × 192), which show the V mark alone.
- The user approved using these assets. The fork derives two cropped variants from the
  primary PNG: navy wordmark for light mode, and the wordmark recoloured to `#F4F6F9` for
  dark mode.

## Mapping onto AnythingLLM

AnythingLLM themes through **palettes** (`frontend/src/palettes/index.js`). A palette is two
seed colours: `main` regenerates the zinc/slate neutral scales and `accent` regenerates
the sky/blue scales. An optional `shades` map pins exact steps. `palettes.css` points the
legacy `--theme-*` variables at those scales. The fork adds a built-in `vironix` palette
and makes it the fallback default. Admins can still pick another palette, and so can users
when the admin hasn't enforced one.

| Vironix token | Palette step / variable |
| --- | --- |
| `main` seed | `#1D2632` (light ink) |
| `accent` seed | `#046DDB` (primary) |
| dark canvas `#101B2B` | `zinc-950` (page) |
| inverse surface `#132033` | `zinc-925` (sidebar) |
| dark surface `#16263A` | `zinc-900` (content, chat) |
| dark surface-muted `#1B2C42` | `zinc-800` (inputs, menus) |
| ink-faint `#8B95A5` | `zinc-500` (muted dark-mode text, kept at 4.7:1 or more) |
| light canvas `#FBFAF8` | `slate-50` (light page container) |
| dark primary `#8FB4FF` / hover `#B9D0FF` | `sky-400` / `sky-300` (dark-mode buttons) |
| light primary `#046DDB` / hover `#0458B0` | `sky-500` / `sky-600` (light-mode buttons) |
| ink / ink-muted | `--theme-text-primary` / `--theme-text-secondary` (light and dark) |
| Libre Franklin | `--theme-font-sans` |

### Branding assets

- `frontend/src/media/logo/vironix-logo-on-{dark,light}.png` (sidebar) and
  `vironix-mark-on-{dark,light}.png` (login) are the defaults in `LogoContext.jsx`.
- `server/storage/assets/anything-llm.png` (dark mode) and `anything-llm-invert.png`
  (light mode) keep their filenames, because the logo-settings code and the database seed
  key off them, but now hold the Vironix wordmark. Existing deployments with a persisted
  `STORAGE_DIR/assets` keep their old files until replaced; an admin can also upload a
  logo under Settings → Customization → Branding.
- `frontend/public/favicon.png` / `favicon.ico` show the V mark.
- AnythingLLM attribution stays: the MIT `LICENSE`, the "AnythingLLM" palette, the
  AnythingLLM icon on built-in provider entries, and the in-app copy and page title
  (rename through custom branding if wanted).

### Known differences from the site

- Primary actions on the login screen and in onboarding hard-code
  `bg-white` (dark) / `light:bg-sky-200` (light) in each component, so they render as
  white or pale-blue-tint buttons rather than solid `#046DDB`. Matching the site exactly
  would mean editing every such component instead of the palette, so they were left as is.
  Their contrast passes AA.
- Headings use Libre Franklin, not Newsreader (see Type).

## Contrast (WCAG 2.x)

Checked by a computed-style scan of all visible text on login, chat, UI preferences, LLM
preference and users pages in both modes: no text below AA.

| Pair | Ratio | AA (4.5 text, 3 UI) |
| --- | --- | --- |
| Light ink on canvas | 14.6 | pass |
| Light ink-muted on white | 7.5 | pass |
| White on primary `#046DDB` | 5.0 | pass |
| Primary `#046DDB` on white (links) | 5.0 | pass |
| Dark ink on surface | 14.1 | pass |
| Dark ink-muted (72%) on surface | 8.0 | pass |
| Near-black on dark primary `#8FB4FF` | 9.3 | pass |
| Dark primary `#8FB4FF` on surface | 7.4 | pass |
| Light ink-faint `#8B95A5` on white | 3.0 | decorative/UI only, never body text |
| *Stock AnythingLLM light secondary `#7A7D7E` on white* | *4.1* | *fails, replaced by ink-muted* |
