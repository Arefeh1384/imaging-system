# Imaging Claims Frontend

The Persian, RTL frontend for the imaging records and insurance system, with a patient portal and an admin panel. It runs today with no backend and is built so a backend can be connected without rewriting the screens.

## Styling

Styles are [Tailwind CSS](https://tailwindcss.com) v4 classes in the components. `src/styles/index.css` holds only the Tailwind import, element defaults such as headings and tables, and the named animations. Class lists used on many screens are in `src/components/classes.ts`.

The theme is generated from `design-system/tokens.json`, so `bg-surface`, `text-title` and `rounded-card` always match the design system. Tailwind's default colors and font sizes are turned off, so a color outside the design system can't slip in by name.

## Screen sizes

Every screen is checked at phone (320 to 600px wide), tablet (768, 820 and 1024px, both ways up), a phone on its side, laptop, and large monitors up to 2560px.

- **Menu:** full on the right from 1280px, a narrow rail with icons and labels from 861px, a bar along the bottom below that.
- **Tables:** they measure themselves and switch to labeled rows only when the columns don't fit.
- **Rows of cards and fields:** a last item fills its line.
- **Review page:** the decision card sits beside the documents from 992px. Below that it follows them, and «رفتن به تصمیم» in the header jumps to it.

## Long lists

Every list from the database is paginated by the server, so no screen ever loads more than one page.

**Request:** `?page=2&pageSize=10`, plus any filters. The server must cap `pageSize` at 100.

**Response:** `{ items, total, page, pageSize }`. If the requested page no longer exists, return the last page and say so in `page`.

| Screen | Endpoint |
| --- | --- |
| Insurance panel: cases the AI passed | `GET /insurance/cases` (`hospitalId`) |
| Main admin: ZIP files, also on a hospital's page | `GET /admin/zips` (`search`, `hospitalId`, `group`) |
| Main admin: accounts | `GET /admin/accounts/staff` (`role`), `GET /admin/accounts/patients` (`search`), `GET /admin/accounts/access-log` |

`GET /admin/zips` also returns `sum`, the fee and share totals for everything matching the filter, not just this page.

To see it with a lot of data, set `VITE_MOCK_EXTRA_ROWS=10000` in `.env`.

## Medical images

There is no DICOM viewer. The backend makes 4 or 5 PNG pictures from each study, spread across it (slices for CT and MRI, views for radiographs, frames for ultrasound), and the screens show those.

- `GET /imaging/cases/:caseId/images` returns `[{ id, label, url, width, height }]` for the insurance panel and the main admin. The insurance panel only gets cases it can see.
- `GET /portal/cases/:caseId/images` returns the same pictures to the patient, so they can confirm the study is theirs.

With sample data the pictures are drawn in the browser (`src/api/mock/dicomSample.ts`). The same file still builds a real DICOM file for the ZIP download.

## Design system

The look of this project is decided in `design-system/`:

- `design-system/README.md`: the rules for content, color, type, layout, motion and icons. Read this before adding a screen.
- `design-system/tokens.json`: the values. `npm run tokens` writes them to `src/styles/tokens.css`, and `npm run dev` and `npm run build` do that by themselves. Don't edit `tokens.css` by hand.
- `design-system/components/`: the rules for each shared component.
- `design-system/assets/`: the mark and icons as SVG files. `public/favicon.svg` is the mark.

Spacing, line heights and font weights are written as Tailwind classes in the components, so changing those tokens does not change the app.

The design page's preview cards and its compiled copy of the components are not in this folder, because a second copy of the code would drift from `src/components`.

## Run it

```bash
npm install
npm run dev
```

Other commands: `npm run build` creates the deployable site in `dist/`, and `npm run typecheck` checks the types.

Sign-ins while in sample mode:

| Panel | Username | Password |
| --- | --- | --- |
| Patient | national ID `1200045211` | mobile `09120004521` |
| Insurance panel | `dana-admin` | `dana1234` |
| Main admin | `admin` | `admin1234` |

## Pages

| Address | Page |
| --- | --- |
| `/` | Entry page |
| `/c/:token` | Where the patient's SMS link lands |
| `/portal/login`, `/portal`, `/portal/profile`, `/portal/cases/:id` | Patient sign-in, all cases, profile and the step-by-step case flow |
| `/insurance/login` | Sign-in for the insurance panel |
| `/insurance/admin`, `/insurance/admin/cases`, `/insurance/admin/cases/:id` | Centers with charts, the cases the AI passed, and one case with its prescription, doctor's opinion, pictures and insurance share |
| `/admin/login` | Main admin sign-in |
| `/admin`, `/admin/companies/:id`, `/admin/hospitals/:id` | Companies, hospitals, totals and gain |
| `/admin/zips`, `/admin/zips/:id` | All ZIPs, and one ZIP with its outcome, files, AI check and fee split |
| `/admin/accounts` | Every account, with the option to open it |
| `/admin/pacs-simulator` | Sample mode only: creates a ZIP event so you can test the full path |

Deploying needs a server rule that sends unknown paths to `index.html`, because the pages use normal URLs.

## ZIP packages

A package is shown by the patient's name, the hospital and the date it arrived, not by the PACS file name. The file name is kept only as the name of the downloaded file. The search box also finds packages by hospital.

- `GET /admin/zips/:id/file` returns the original ZIP (`application/zip`). Sample mode keeps no uploaded bytes, so it builds a small ZIP with a `manifest.json` and one sample DICOM image.

## Lists on phones

On phones, table rows and the account lists fold to their main lines. A «جزئیات» button opens the rest, and only one row is open at a time. `ResponsiveTable` takes `keep` (the columns a folded row still shows), table rows use `ExpandRow`, and list rows use `ExpandItem` inside `ExpandList`. Page navigation is centered at every size.

## Patient sign-in

The patient enters their national ID and mobile. If the two match, a 5-digit code goes to that mobile by SMS, and entering it opens the case. Sample mode sends no real SMS and shows the code on the page instead.

- `POST /portal/login/code` takes `{ nationalId, mobile }` and returns `OtpChallenge`. A wrong pair returns `INVALID_LOGIN`.
- `POST /portal/login/verify` takes `{ challengeId, code }` and returns the session. Errors: `WRONG_CODE`, `TOO_MANY_ATTEMPTS`, `CODE_EXPIRED`. After the last two the screen asks for a new code.

The screen uses these values from the response, and the sample backend sets them to 2 minutes, 60 seconds between SMS, and 5 wrong tries. A real backend must also:

- Create and check the code on the server, store it hashed, and use it only once.
- Never return `sampleCode`.
- Limit requests per mobile and per IP. Otherwise this endpoint can be used to run up the SMS bill, or to test which national ID belongs to which mobile.
- Keep the code out of logs and out of the SMS history shown to admins.

## Patient confirmation, check and insurance share

- `POST /portal/cases/:id/confirm/:key` with `{ yes }`. `service` records whether the patient had this imaging on that date at that center. `prescription` records whether a prescription that came in the ZIP is theirs. `yes: false` rejects the case for a conflict and sends the patient the SMS. The patient isn't asked about the pictures or the radiologist report.
- `POST /portal/cases/:id/e-prescription` with `{ eRxId }` records the code of an electronic prescription when the ZIP had none. The sample accepts 6 to 24 letters or digits and returns `INVALID_ERX` otherwise. A paper prescription is uploaded as a photo instead.
- `POST /portal/cases/:id/submit` is the «تأیید» button. The case moves to `PROCESSING` and the patient is told the result will come by SMS.
- The check runs later, 30 to 60 minutes after the patient confirms. It fetches the e-prescription by its code and compares the prescription, the report and the pictures with each other and with the patient. No conflict: the case moves to `AT_INSURER` with `insuranceShare`, and the patient gets an SMS that the case is complete and was sent to the insurer. A conflict: `REJECTED_CONFLICT` with `conflict`, and the conflict SMS goes out.
- Sample mode runs the check 20 seconds after «تأیید», so it can be watched. The ZIP page in the main admin also has a «انجام بررسی الان» button for cases waiting for the check.
- The insurance share is a fixed amount per type of imaging, from the insurer's price list. The sample list in `src/api/mock/seed.ts` (MRI 1,500,000, CT 1,200,000, ultrasound 400,000, radiography 250,000 Toman) is illustrative.
- `GET /insurance/cases/:id` returns only cases in `AT_INSURER`. Cases being checked or in conflict never reach the insurer.

## Connecting the backend

`VITE_API_MODE` picks where the screens get their data:

- `mock`: everything on sample data in the browser. No backend needed.
- `hybrid`: the patient, insurance and PACS admin panels call the backend; the main admin panel stays on sample data. Kept for working on the admin screens without the backend.
- `http`: everything calls the backend at `VITE_API_BASE_URL`. Docker builds this mode.

`VITE_DEMO_ACCOUNTS=true` shows the test accounts on the sign-in pages of a test server. Leave it unset on a real server.

With `npm run dev`, set `VITE_API_MODE=http` and `VITE_API_BASE_URL=/api/v1` in `.env` (and `VITE_DEMO_ACCOUNTS=true` if you want the test accounts shown). Vite passes `/api` to the backend on port 8000 (`vite.config.ts`).

Screens only talk to the `ApiClient` interface in `src/api/types.ts`, and `src/api/client.ts` picks the implementation. Sample-only controls (the PACS simulator, the sample hints) disappear where the data is real. The one-time code is shown on the page whenever the backend returns `sampleCode`, which it only does in demo mode.

## How a case moves

1. A relay takes the image link and the other details from PACS, downloads the images, zips everything and sends it. Medical images and patient details are required. The prescription and the radiologist report may be in the ZIP or missing.
2. The patient gets an SMS saying their case moved forward and asking them to sign in. They sign in with national ID and mobile, then the one-time code sent to that mobile. On the first visit they add insurance details. PACS details aren't shown at sign-in.
3. Each imaging service is its own case and is confirmed on its own, even two on the same day. The first question is whether they had this imaging on that date at that center.
4. If the prescription came in the ZIP, the patient only confirms it is theirs. If it is missing, they enter the code of an electronic prescription or upload a photo of a paper one. A missing radiologist report is uploaded too.
5. The patient presses «تأیید» and is told the result will come by SMS. Any other service still waiting is offered next.
6. 30 to 60 minutes later, the system fetches the e-prescription and checks it, the report and the pictures against each other. No conflict: the share is worked out from the price list, the case appears in the insurance panel with the prescription, the doctor's opinion (the radiologist's report), the pictures and the share, and the patient gets an SMS that it was sent to the insurer.
7. A conflict, found by the check or by a patient's «no»: the case is rejected and the patient gets an SMS to call the center so it sends the information again. The main admin sees how many cases were rejected this way, and whether the AI or the patient found the conflict.

Patients never receive AI results or amounts: `PatientCase` in `src/api/types.ts` doesn't contain those fields. The backend must keep this separation.

## Decisions to review

- A fee counts as soon as a ZIP is accepted. The design document leaves the revenue event open.
- A rejected case is closed. The center sends a new ZIP, which starts a new case.
- The insurance panel only views cases. It has no approve or pay action.
- When the main admin opens another account, the opening is logged and any action there is marked as done by the main admin.
- Staff sign-in is username and password for now. The design document calls for multi-factor sign-in, which the backend will need to provide.
- The fee amounts and the insurance price list are illustrative. The real ones still need confirming.
- Scanning resizes the photo and raises its contrast. It doesn't crop to the paper's edges.

## Project layout

```
src/
  api/          ApiClient contract, real HTTP client, local sample backend
  components/   Shared UI and case views
  features/     public, patient, insurance and admin screens
  lib/          Formatting, validation, routing, storage
  styles/       Design tokens and styles, with light and dark themes
```
