# Imaging and insurance system

The frontend and its backend, with all four panels connected: a hospital PACS sends a ZIP, the patient gets an SMS, signs in, confirms the service and the prescription, and presses «تأیید». Later the system fetches the e-prescription, checks the prescription, report and image against each other, and either sends the case to the insurer with its share or rejects it. The patient is told by SMS either way.

The PACS, the SMS gateway and the e-prescription service are stand-ins in the **sandbox**, so the whole path runs on one computer with invented data.

**To run it, follow [docs/DOCKER-GUIDE.md](docs/DOCKER-GUIDE.md).** In short: `docker compose up --build`, then open http://localhost:8001.

## What's inside

| Folder | What it is | Port |
| --- | --- | --- |
| `frontend/` | React app. Docker builds it with `VITE_API_MODE=http`: every panel (patient, insurance, PACS admin, main admin) calls the backend. `VITE_DEMO_ACCOUNTS=true` shows the test accounts on the sign-in pages. | 8080 |
| `backend/` | FastAPI + SQLite. PACS intake, patient sign-in, the patient's case actions, the background check, and the insurance, PACS admin and main admin panels. API docs at `/docs`. | 8000 |
| `sandbox/` | Sample PACS with an «ارسال» button per study, SMS inbox, e-prescription service. | 8001 |
| `datasets/` | 15 invented mammography cases: DICOM, details, reports, prescriptions, e-prescriptions, photos for the patient to upload. | |
| `docs/` | The Docker guide. | |

## How a case moves

1. **PACS «ارسال»**: the sandbox builds a ZIP (`metadata.json`, `images/1.dcm`, and `report.json` and `prescription.png` when the hospital has them) and posts it to `POST /api/v1/ingest` with the `X-Api-Key` header.
2. **Intake**: the backend checks the ZIP (details complete, at least one readable DICOM, not a duplicate study, not too large), creates the patient if new and the case, and sends the invite SMS: "کار پرونده شما را جلو بردیم… وارد پنل کاربری خود شوید". Whatever the ZIP lacked (prescription, report) is requested from the patient.
3. **Sign-in**: national ID and mobile, then a 5-digit code by SMS (2 minutes, 60 seconds between codes, 5 tries). On the first visit, insurance details only.
4. **Confirmation**: "On {date}, did you go to {center} for {imaging}?" Each service is its own case. If the prescription came in the ZIP, the patient confirms it is theirs. If not, they type the e-prescription code or upload a photo of the paper one. «No» to either question rejects the case right away.
5. **«تأیید»**: the case moves to `PROCESSING` and waits `CHECK_DELAY_SECONDS` (60 for testing, 1800 to 3600 for real).
6. **Check**, in a background worker:
   - Fetches the e-prescription by its code. If no prescription has that code, the case goes back to the patient with an SMS to enter it again; this is treated as a typing mistake, not a conflict.
   - Makes a PNG from the DICOM.
   - Asks the checker four questions: does the prescription's service match the imaging, is the prescription for this patient, is the report about this imaging, does the DICOM belong to this patient?
   - All pass: `AT_INSURER`, the share from the price list (mammography 600,000 Toman), SMS "پرونده شما کامل است و برای بیمه ارسال شد". The case appears in the insurance panel's case list with the prescription, the report, the DICOM picture, the AI's findings and the share.
   - A conflict: `REJECTED_CONFLICT` with the reason, SMS to call the center.
   - Checker unreachable: tried again in 5 minutes.

## Main admin panel

At `/admin`. Everything, for whoever runs the system:
- **Companies and hospitals:** each hospital belongs to a company, which the relay can send with the hospital (`hospital.company` in `metadata.json`); hospitals without one go under «بدون شرکت». Totals, fees and recent activity per company and hospital.
- **Fees:** each hospital has a fee rule (fee per ZIP and its split between hospital, insurer and management). Each accepted ZIP records its fee and split when it arrives, so changing a rule affects only later ZIPs. A ZIP's split can be edited until it is settled; settling locks it.
- **ZIPs:** every ZIP, accepted or refused, searchable and filterable by hospital, case stage, billing and settlement. A ZIP's page shows the full case (documents, DICOM pictures, the AI's answer, events, SMS), the fee, settlement and a reminder SMS for patients who haven't finished. Every ZIP the relay sends is kept and can be downloaded as sent (except ones over the size limit).
- **Accounts:** insurance accounts and patients, with "view as" to see exactly what they see. Every "view as" is written to the access log.

The upgrade adds its columns to an existing database on the next start and fills them in: earlier hospitals go under «بدون شرکت» until the relay sends their company, and earlier accepted ZIPs get the default fee.

## PACS admin panel

At `/pacs-admin`, for whoever runs the PACS relay. It answers one question: how much each medical center has sent. For today, 7 days, 30 days or everything: the total, accepted and refused ZIPs, size, one bar per day, and a row per center with its share of the total and its last send. Centers that sent nothing in the period are listed too. Every ZIP counts once, accepted or not; days are Tehran time. The panel never shows patients or medical content, and its account can't open the insurance panel.

## The checker

`CHECKER=fake` (default) compares the written details: the e-prescription, the prescription details the hospital sends in `metadata.json`, the report text and the DICOM tags. It can't read photos, so a photographed prescription passes with a note saying so.

`CHECKER=openrouter` sends the picture, the prescription (picture, PDF or e-prescription JSON) and the report to a vision model through OpenRouter's chat completions API, and asks for a JSON answer with the same four checks, written in Persian. The default model is `google/gemini-2.5-flash`; `OPENROUTER_MODEL` picks another. It asks for a strict JSON schema and, if no provider of the chosen model supports that, asks again for JSON in words. `backend/tests/test_openrouter_contract.py` checks this against a local stand-in, without calling OpenRouter.

`CHECKER=gemini` does the same straight through Google's Gemini API (`backend/tests/test_gemini_contract.py`). Both use `AI_PROXY` when a VPN proxy is needed, and `python -m app.checker.ping` tests the connection.

## Backend endpoints

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/ingest` | ZIP from the PACS relay. 201 accepted, 409 duplicate, 413 too large, 422 incomplete. |
| `GET /api/v1/portal/invites/{token}` | The SMS link: which case it opens. |
| `POST /api/v1/portal/login/code`, `/login/verify` | Sign-in with national ID, mobile and the one-time code. |
| `GET /api/v1/portal/me`, `PUT /api/v1/portal/me/insurance` | Profile; insurance details on the first visit. |
| `GET /api/v1/portal/cases`, `/cases/{id}` | The patient's cases. No AI result and no amounts. |
| `PUT /api/v1/portal/cases/{id}/documents/{key}` | Photo or PDF of the prescription or the report. |
| `POST /api/v1/portal/cases/{id}/confirm/{key}` | `{yes}` for `service` or `prescription`. |
| `POST /api/v1/portal/cases/{id}/e-prescription` | `{eRxId}` |
| `POST /api/v1/portal/cases/{id}/submit` | The «تأیید» button. |
| `POST /api/v1/insurance/login` | Insurance panel sign-in (`INSURANCE_USERNAME`, `INSURANCE_PASSWORD`; passwords stored hashed). |
| `GET /api/v1/insurance/dashboard` | Counts, shares and fees, overall and per center. |
| `GET /api/v1/insurance/cases` | Approved cases only, newest first. `hospitalId`, `page`, `pageSize`. |
| `GET /api/v1/insurance/cases/{id}` | One approved case: patient, documents, AI opinion, share. Rejected or waiting cases answer 404. |
| `GET /api/v1/imaging/cases/{id}/images` | The DICOM pictures as PNG: approved cases for the insurer, any case for the main admin. |
| `POST /api/v1/pacs-admin/login` | PACS admin sign-in (`PACS_ADMIN_USERNAME`, `PACS_ADMIN_PASSWORD`). |
| `GET /api/v1/pacs-admin/volume` | How many ZIPs each center sent: `period` = `today`, `7d`, `30d` or `all`. Counts, size and last send per center, and one count per day. No patient data. |
| `POST /api/v1/admin/login` | Main admin sign-in (`ADMIN_USERNAME`, `ADMIN_PASSWORD`). |
| `GET /api/v1/admin/overview`, `/admin/companies/{id}`, `/admin/hospitals/{id}` | Totals, fees, case pipeline and recent activity. |
| `PUT /api/v1/admin/hospitals/{id}/fee-rule` | A hospital's fee per ZIP and its split, for later ZIPs. |
| `GET /api/v1/admin/zips`, `/admin/zips/{id}`, `/admin/zips/{id}/file` | ZIP list (search, hospital, group, pages, fee totals), one ZIP with its case, and the file as sent. |
| `PUT /api/v1/admin/zips/{id}/split`, `POST /admin/zips/{id}/settle` | Edit a ZIP's split; record its settlement, which locks it. |
| `POST /api/v1/admin/cases/{id}/resend-invite` | Reminder SMS to a patient who hasn't finished. |
| `GET /api/v1/admin/accounts/staff`, `/patients`, `/access-log`; `POST .../view-as` | Accounts, "view as", and its log. |
| `/api/v1/dev/...` | Demo tools (list cases, events, check now, reset). Only with `DEMO_MODE=true`. |

Errors come back as `{"code": "...", "message": "..."}` with a Persian message, which the frontend shows as is.

## Sample data

`datasets/cases.json` lists the 15 cases, what each tests and the expected result. `sandbox/tools/generate_sample.py` made them: the mammograms are drawn (a breast shape, tissue texture, the side and view marker), and the prescriptions and reports are drawn as paper. Names, national IDs (valid check digit) and mobiles are invented. `sandbox/tools/import_kaggle.py` swaps in real Kaggle mammograms (guide, step 9).

## Not real yet

- The main admin's account list shows insurance accounts only; the PACS admin and main admin accounts are managed through `.env` for now.
- The PACS simulator page and the "run the check now" button exist only in sample mode; with the backend, the sandbox's PACS page sends ZIPs and the check runs on its own.
- SMS and the e-prescription service are stand-ins. Real ones mean changing `SMS_GATEWAY_URL`, `ERX_SERVICE_URL` and the request shapes in `backend/app/gateways.py`.
- Demo mode returns the one-time code to the page and opens `/api/v1/dev`. Set `DEMO_MODE=false` anywhere other than your own computer.
- SQLite fits a single server and testing. For production, PostgreSQL is the usual move; `backend/app/db.py` is the only file that talks to the database.
- The PACS key is one shared key. A real relay would have a key per hospital.
- The tariff is illustrative (`backend/app/tariff.py`).

## Tests

| Test | How to run |
| --- | --- |
| All 15 cases through the API, about 200 checks | `docker compose exec backend python tests/smoke_test.py` |
| OpenRouter request and answer handling | `docker compose exec backend python tests/test_openrouter_contract.py` |
| Gemini request and answer handling | `docker compose exec backend python tests/test_gemini_contract.py` |
| AI connection with your key | `docker compose exec backend python -m app.checker.ping` |
