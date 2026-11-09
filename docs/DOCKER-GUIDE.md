# Running the system with Docker: a step-by-step guide

This guide assumes you have never used Docker. You already have Docker Desktop and WSL installed and connected, which is all the setup needed. Every command below goes into **PowerShell** on Windows.

## What Docker does here, in four sentences

A **container** is a small, sealed computer that runs one program, with everything that program needs already inside it. This project has three: the **frontend** (the website), the **backend** (our server and database), and the **sandbox** (a fake PACS, a fake SMS gateway and a fake e-prescription service). An **image** is the recipe a container is made from; `docker compose` reads `docker-compose.yml`, builds the three images and starts the three containers, connected to each other. You never install Python, Node or a database yourself: Docker does it inside the containers.

```
 your browser
     │
     ├── http://localhost:8080 ──► frontend (nginx + React) ──/api──► backend (FastAPI + SQLite) :8000
     │                                                                   │        ▲
     └── http://localhost:8001 ──► sandbox                               │        │ ZIP from «ارسال»
                                    ├─ PACS page ────────────────────────┼────────┘
                                    ├─ SMS gateway ◄── SMS ───────────────┤
                                    └─ e-prescription service ◄── lookup ─┘
```

## 1. Check that Docker works

1. Open **Docker Desktop** from the Start menu. Wait until the bottom-left corner says **Engine running** (green).
2. Open **PowerShell** (Start menu, type `powershell`, press Enter) and run:

   ```powershell
   docker version
   docker compose version
   docker run --rm hello-world
   ```

   The last command should print `Hello from Docker!`. If it says it cannot download the image, see [Troubleshooting](#troubleshooting): Docker Hub is sometimes unreachable from Iran.

## 2. Put the project in a folder

Extract the zip so you have `D:\imaging-system` with these inside: `backend`, `frontend`, `sandbox`, `datasets`, `docs`, `docker-compose.yml`.

Then go to that folder in PowerShell:

```powershell
cd D:\imaging-system
```

Tip: in File Explorer, open the folder, click the address bar, type `powershell` and press Enter. A PowerShell window opens already in that folder.

## 3. (Optional) Make your settings file

Docker works with the defaults, so you can skip this. To change settings later (such as the waiting time before the check, or Gemini), make your own copy:

```powershell
copy .env.example .env
notepad .env
```

## 4. Build and start everything

```powershell
docker compose up --build
```

The first time takes **5 to 15 minutes**: Docker downloads Python, Node and nginx, then installs the packages. Later starts take seconds.

The window fills with log lines from the three containers. It is ready when you see lines like:

```
backend-1   | INFO ... checker: بررسی آزمایشی بدون هوش مصنوعی, check delay: 60s, demo mode: True
backend-1   | INFO:     Uvicorn running on http://0.0.0.0:8000
sandbox-1   | INFO:     Uvicorn running on http://0.0.0.0:8001
frontend-1  | ... start worker processes
```

**Leave this window open.** It is the live log; closing it or pressing `Ctrl+C` stops the system.

To run in the background instead, use `docker compose up --build -d`. The window is then free, and you see logs with `docker compose logs -f`.

## 5. Open the three pages

| Address | What it is |
| --- | --- |
| http://localhost:8001 | **Sample PACS**, SMS inbox and e-prescription list. Start here. |
| http://localhost:8080 | The **frontend**. The patient panel uses the backend; the admin and insurance panels still show sample data. |
| http://localhost:8000/docs | The backend's **API documentation**. You can try every endpoint from this page. |

## 6. Try the whole path once

1. On **http://localhost:8001**, find **MG-001** (سارا رحیمی) and press **«ارسال به سامانه»**. A green message says it was sent.
2. Open the **«پیامک‌ها»** tab. Sara has an SMS: "کار پرونده شما را جلو بردیم…" with a link. Click the link.
3. The patient panel opens. The yellow box shows the national ID and mobile to type (demo mode only). Press **«گرفتن کد ورود»**.
4. The code appears in the yellow box and in the SMS inbox. Type it.
5. First visit: fill in the insurance details.
6. Answer **«بله، این خدمت را گرفته‌ام»**, then confirm the prescription, then press **«تأیید»**.
7. About a minute later (`CHECK_DELAY_SECONDS`), the screen changes to "sent to insurance", and a new SMS arrives. On the PACS page, the case shows **«ارسال‌شده به بیمه»**. To skip the wait, press **«بررسی الان»** on the PACS page.

Each sample case tests one situation; its card says what to do and what result to expect:

| Case | What it tests |
| --- | --- |
| MG-001, MG-002 | Prescription in the ZIP. Same patient, two services on the same day, confirmed separately. |
| MG-003, MG-014 | Electronic prescription: the patient types the code from the «نسخه الکترونیک» tab. For MG-014, type a wrong code first: the case comes back to the patient by SMS. |
| MG-004, MG-011 | Paper prescription: upload the photo linked on the case card. MG-011 also needs the report photo. |
| MG-005 | Report missing from the ZIP: upload the report photo. |
| MG-006, MG-009 | Conflict: the prescription is for a different service. |
| MG-007, MG-008 | Conflict: the prescription is in someone else's name. |
| MG-010 | Conflict: the report is about a different imaging study. |
| MG-012 | Answer «نه، نگرفته‌ام»: rejected because the patient says no. |
| MG-013 | ZIP without a DICOM image: the backend refuses it. |
| MG-015 | Send it twice: the second ZIP is refused as a duplicate. |

**«شروع دوباره»** on the PACS page deletes all cases and SMS, so you can start over.

## 7. Stop, start again, and reset

| To… | Run |
| --- | --- |
| Stop | `Ctrl+C` in the log window, or `docker compose down` |
| Start again (no code changes) | `docker compose up` |
| Start again after changing code | `docker compose up --build` |
| See what is running | `docker compose ps` |
| See one container's log | `docker compose logs -f backend` |
| Restart one container | `docker compose restart backend` |
| Delete all data (database, files, SMS) | `docker compose down -v` |
| Run the automatic test of all 15 cases | `docker compose exec backend python tests/smoke_test.py` (it wipes the data first) |

Data is kept between starts in two Docker **volumes** (`imaging_backend-data` and `imaging_sandbox-data`). `docker compose down` keeps them; `docker compose down -v` deletes them.

You can do most of this in **Docker Desktop** too: the **Containers** tab shows a group called **imaging**. Click it to see each container's logs, or use the stop, start and delete buttons.

## 8. Change a setting

1. Edit `.env` (step 3).
2. Run `docker compose up -d`. Docker restarts only the containers whose settings changed.

For example, to make the check wait 30 minutes like the real service, set `CHECK_DELAY_SECONDS=1800`.

## 9. Use real mammograms from Kaggle

The sample DICOM files are drawn by a script, so you can work without downloading anything. To use real images:

1. Sign in at [kaggle.com](https://www.kaggle.com) and open the competition **RSNA Screening Mammography Breast Cancer Detection**. Accept the competition rules (Kaggle requires it before downloading).
2. In the **Data** tab, open `train_images`. Each folder is one patient and each `.dcm` file is one picture. Download about 15 files one by one with the download button next to each file. You don't need the whole dataset, which is several hundred gigabytes.
3. Put the files in `D:\imaging-system\datasets\kaggle\`.
4. Run:

   ```powershell
   docker compose run --rm sandbox python tools/import_kaggle.py
   ```

   It gives each Kaggle image the fake patient, center and study details of one sample case, so everything in the ZIP agrees. Where a file says which breast it shows, it goes to a case for that breast. MG-001 and MG-002 need one right (R) and one left (L) image.
5. On the PACS page, press **«شروع دوباره»** and send the cases again.

To go back to the drawn images: `docker compose run --rm sandbox python tools/import_kaggle.py --restore`.

## 10. Switch on AI checking (OpenRouter)

The system starts with a **fake checker**: it compares the written details (the e-prescription, the prescription details from the hospital, the report text, the DICOM details) and cannot read photos. With AI checking, a vision model looks at the pictures themselves: the DICOM image, the prescription (photo, scan, PDF or the fetched e-prescription) and the report.

1. Get a key at **openrouter.ai/keys**. Some models need credit on the account; free models have low limits.
2. In `.env`:

   ```
   CHECKER=openrouter
   OPENROUTER_API_KEY=sk-or-v1-...
   OPENROUTER_MODEL=google/gemini-2.5-flash
   ```

   Any model on OpenRouter that accepts images works. Copy its name from the model's page on openrouter.ai, such as `google/gemini-2.5-flash` or `openai/gpt-4o-mini`.
3. If OpenRouter can't be reached from your network, route it through your VPN's local proxy (for example v2rayN on port 10809):

   ```
   AI_PROXY=http://host.docker.internal:10809
   ```

   `host.docker.internal` means "my own computer" when used from inside a container.
4. Run `docker compose up -d`. The backend log should say `checker: OpenRouter (google/gemini-2.5-flash)`.
5. Test the connection before sending cases:

   ```powershell
   docker compose exec backend python -m app.checker.ping
   ```

   It prints `It works` or says what is wrong: the key was refused, there isn't enough credit, the model name isn't found, the rate limit was reached, or the network can't reach OpenRouter (use `AI_PROXY`).
6. On the PACS page, send **MG-006** (prescription for an ultrasound, image is a mammogram) and **MG-001** (everything matches). Answer as the patient, then press **«بررسی الان»**. Under **«رویدادها»** you see the model's answer in Persian.

If the AI service cannot be reached or refuses (no internet, wrong key, no credit), the case is not rejected: it waits and is tried again 5 minutes later, and the reason appears under «رویدادها».

To use Google's Gemini API directly instead, set `CHECKER=gemini` and `GEMINI_API_KEY`. Both key kinds from Google AI Studio work: `AIza…` and `AQ.…`.

Keep keys in `.env` only. `.env` is not shared when you share the code.

## 11. Work on the frontend with live reload

Docker serves a built copy of the frontend, so code changes need `docker compose up --build frontend`. For quick changes, run the frontend the usual way while Docker runs the backend:

1. In `frontend\`, create a file named `.env` with:

   ```
   VITE_API_MODE=hybrid
   VITE_API_BASE_URL=/api/v1
   ```

2. Run `npm install` once, then `npm run dev`, and open http://localhost:5173. Calls to `/api` go to the backend on port 8000.

The SMS links still point to port 8080 (the Docker frontend). Both work.

## 12. Let others on your network test it

1. Find your computer's address: run `ipconfig` and look under **Wireless LAN adapter Wi-Fi** (or **Ethernet adapter**) for **IPv4 Address**, such as `192.168.1.25`. Ignore the `vEthernet (WSL)` and Docker entries (usually `172.x.x.x`).
2. Put it in `.env` so SMS links point to it, then run `docker compose up -d`:

   ```
   PORTAL_URL=http://192.168.1.25:8080
   ```

3. Allow the ports through Windows Firewall. In PowerShell **as administrator**:

   ```powershell
   New-NetFirewallRule -DisplayName "Imaging demo" -Direction Inbound -Protocol TCP -LocalPort 8080,8001,8000 -Action Allow -Profile Private
   ```

   Your network must be set to **Private**: Settings → Network & internet → Wi-Fi (or Ethernet) → your network → Network profile type → Private.
4. Others on the same network open `http://192.168.1.25:8080` (patient panel) and `http://192.168.1.25:8001` (sample PACS and SMS inbox). Check from your own phone first.

Demo mode shows login codes on the page, so share it only on a network you trust. Your address can change when you reconnect; if it does, update `PORTAL_URL`. SMS sent before the change keep the old link: press «شروع دوباره» and send the cases again. Guest and some office Wi-Fi networks block devices from reaching each other; use a home network or a phone hotspot instead.

## Troubleshooting

**`docker compose up` can't download images (`python`, `node`, `nginx`)**
Docker Hub sometimes refuses connections from Iran. Two fixes:
- Turn on your VPN before running the command.
- Or add a Docker Hub mirror: Docker Desktop → Settings → **Docker Engine**, add a `registry-mirrors` line, then **Apply & restart**:

  ```json
  {
    "registry-mirrors": ["https://<mirror address>"]
  }
  ```

  Iranian cloud providers such as ArvanCloud run Docker Hub mirrors. Take the current address from their documentation, since these addresses change.

**Installing Python or npm packages fails during the build**
Set `PIP_INDEX_URL` or `NPM_REGISTRY` in `.env` to a mirror you can reach, then `docker compose build --no-cache` and `docker compose up`.

**`port is already allocated` or `address already in use`**
Something else uses port 8080, 8000 or 8001. Close it, or change the left number in `docker-compose.yml` (for example `"8081:80"`). If you change 8080, also set `PORTAL_URL=http://localhost:8081` in `.env` so SMS links point to the right place.

**The page at localhost:8080 says it cannot connect to the server**
The backend isn't running or is still starting. Run `docker compose ps`: `backend` should say `healthy`. If not, `docker compose logs backend` shows why.

**The check never finishes**
Look at «رویدادها» for the case on the PACS page. With Gemini, the reason (no connection, bad key, quota) is written there.

**Docker Desktop is slow or uses a lot of memory**
In Docker Desktop → Settings → Resources (or `%UserProfile%\.wslconfig` for WSL), give it at least 4 GB of memory.
