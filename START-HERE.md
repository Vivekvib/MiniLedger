# MiniLedger: start here (first-time guide)

This guide is for someone who has **never set up a project like this**. It assumes nothing. Every step says what to click or type, and what you should see afterwards.

MiniLedger is a small app for keeping track of money you lend to friends: who owes you, how much, by when, and whether they have paid you back. You can also attach a **photo of a receipt** to a loan.

> **Time:** about 45 to 60 minutes the first time (most of it is waiting for downloads). After that, starting it takes about 2 minutes.
>
> **Honest note:** the steps below were written and checked from the project's own commands, but they were **not** tried on a fresh Windows computer by the person who wrote them. They use the normal installers and are the standard way to do this. If a step does not match what you see, go to [When something goes wrong](#12-when-something-goes-wrong).

---

## What you will end up with

Three things running together:

```
  Your phone              Your computer
 ┌───────────┐       ┌───────────────────────────────────────┐
 │ MiniLedger │ ───▶ │ the "backend" (a small program)       │ ───▶ the "database"
 │ app        │ ◀─── │ it also shows your login code here    │      (PostgreSQL)
 └───────────┘       └───────────────────────────────────────┘
```

- The **app** is what you tap on your phone.
- The **backend** is a small program that runs on your computer. The app talks to it.
- The **database** is where the loans are stored (also on your computer).

You will keep **two black or blue windows open** on your computer while you use the app. They are called *terminals* (explained in the [word list](#14-words-explained)). Don't close them until you are done.

---

## 1. What you need

| You need | Notes |
|---|---|
| A computer | Windows 10 or 11 (these steps), or a Mac ([short notes](#13-on-a-mac-or-linux)) |
| An Android phone | With a USB cable that can carry data (some cables only charge) |
| Internet | For downloading the tools |
| About 3 GB free disk space | |
| The project folder | A file called `MiniLedger.zip` (or a `MiniLedger` folder) |

You do **not** need an Expo account, a Google account, a paid anything, or any programming knowledge.

---

## 2. Install the tools (one time)

### 2a. Node.js (runs the backend and the app tools)

1. Open <https://nodejs.org>.
2. Download the **LTS** installer for Windows. This project was tested with **version 22**: if the page offers a newer number, use the version picker on the download page and choose **22**.
3. Run the installer. Click **Next** through everything and leave the default choices. If it asks about "automatically install necessary tools", leave it **unticked**.
4. When it finishes, **restart your computer** (this makes Windows notice the new program).

### 2b. PostgreSQL (the database)

1. Open <https://www.postgresql.org/download/windows/> and click **Download the installer** (it is from a company called EDB). Pick **version 16**.
2. Run it. Click **Next** and keep the default choices (folder, components, port **5432**).
3. When it asks for a **password for the database superuser (postgres)**, type one you will remember and **write it down**. You need it once, in step 5.
4. Keep clicking **Next**. At the end, if it offers to launch "Stack Builder", **untick** that box and click **Finish**.

PostgreSQL starts by itself every time Windows starts, so you normally never have to start it.

### 2c. The tool that links your phone to your computer (`adb`)

You need this if you connect your phone with a USB cable (the way that was tested). If you already have **Android Studio**, you already have it: skip to 2d.

1. Open <https://developer.android.com/tools/releases/platform-tools> and download **SDK Platform-Tools for Windows**.
2. Right-click the downloaded zip → **Extract All**. Move the extracted `platform-tools` folder to `C:\platform-tools`.
3. Tell Windows where it is: press the Windows key, type **environment variables**, open **Edit the system environment variables** → **Environment Variables…** → under *User variables* select **Path** → **Edit…** → **New** → type `C:\platform-tools` → **OK** on every window.

### 2d. Set up your phone

1. **Turn on Developer options:** *Settings → About phone* → tap **Build number** seven times. It says "You are now a developer".
2. *Settings → System → Developer options* → turn on **USB debugging**. (The menu names vary a little between phone brands; search for "USB debugging" in Settings.)
3. Plug the phone into the computer. On the phone, a box asks **Allow USB debugging?** → tick "Always allow from this computer" → **Allow**.
4. Set the USB mode to **File transfer** (pull down the notifications and tap the "USB" notification) if nothing shows up later.

---

## 3. Get the project onto your computer

1. Make a folder `C:\dev` (in File Explorer: open *This PC → Local Disk (C:)* → right-click → *New → Folder* → name it `dev`). A short folder path avoids problems on Windows.
2. Right-click `MiniLedger.zip` → **Extract All…** → type `C:\dev` as the destination → **Extract**.
3. You should now have `C:\dev\MiniLedger`. Open it. Inside you should see folders named `backend`, `mobile` and `docs`, and files named `README.md` and `START-HERE.md`.

### How to open a terminal in a folder

You will do this several times:

1. In File Explorer, open the folder you want.
2. Click once in the **address bar** at the top (where the path is written) so the text is selected.
3. Type `powershell` and press **Enter**.

A blue window opens. It is already "in" that folder. The text before the `>` shows which folder (for example `PS C:\dev\MiniLedger>`).

**To type a command:** copy it from this page, click in the blue window, and **right-click** (that pastes), then press **Enter**. Type or paste one command at a time and wait for it to finish (you will see the `PS C:\...>` text come back).

### If PowerShell says "running scripts is disabled"

Some Windows computers block `npm` the first time. If any command below shows a red message containing *"running scripts is disabled on this system"*, run this **once**, then repeat the command that failed:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Answer **Y** if it asks.

### Check the tools are installed

Open a terminal in `C:\dev\MiniLedger` (as above) and run:

```powershell
node --version
```

You should see `v22.` followed by numbers. If you see "not recognized", restart the computer and try again.

```powershell
adb version
```

You should see "Android Debug Bridge version…". If you see "not recognized", redo 2c, then **close and reopen** the terminal.

```powershell
adb devices
```

You should see your phone listed with the word **device** next to it. If it says **unauthorized**, look at your phone and tap **Allow**. If the list is empty, try another cable or USB port, and check USB debugging is on.

---

## 4. Install the project's parts (one time, a few minutes)

In a terminal opened in `C:\dev\MiniLedger`, run these **one at a time** and wait for each to finish:

```powershell
cd backend
npm install
```
```powershell
cd ..\mobile
npm install
```
```powershell
cd ..
```

Lots of text scrolls past. **Warnings in yellow are normal.** It finished when the `PS C:\...>` text comes back. The second one is the slow one (3 to 6 minutes). A message about "vulnerabilities" is expected and harmless here (it is about developer tools, not the app).

---

## 5. Create the database (one time)

1. Press the Windows key, type **SQL Shell (psql)** and open it. A window opens that asks questions.
2. Press **Enter** four times to accept the suggestions for *Server*, *Database*, *Port* and *Username*.
3. It asks for **Password for user postgres**. Type the password you chose in step 2b (**the letters do not show as you type; that is normal**) and press **Enter**. You should see a prompt that looks like `postgres=#`.
4. Copy and paste these **three lines, one at a time**, pressing Enter after each:

```sql
CREATE USER miniledger WITH PASSWORD 'miniledger_local';
```
```sql
CREATE DATABASE miniledger_dev OWNER miniledger;
```
```sql
CREATE DATABASE miniledger_test OWNER miniledger;
```

After the lines you should see, in order: `CREATE ROLE`, `CREATE DATABASE`, `CREATE DATABASE`.

5. Type `\q` and press Enter to leave. Close the window.

(`miniledger_test` is only used by the automated checks in [step 15](#15-optional-run-the-automated-checks). The password `miniledger_local` is for this local, private copy only.)

---

## 6. Create the backend's settings file (one time)

Open a terminal in `C:\dev\MiniLedger\backend` (open the `backend` folder, then type `powershell` in the address bar) and run:

```powershell
npm run setup:env
```

You should see: `Created backend/.env with two new random secrets.` This makes a private settings file called `.env` with secret keys generated for you. **Never share that file or post it online.**

(If it says `backend/.env already exists`, that is fine: it left your file alone.)

---

## 7. Create the tables in the database (one time, and again after an update)

In the **same** terminal (still in `backend`):

```powershell
npm run migrate:up
```

You should see a list of steps and, near the end, **`Migrations complete!`**. Running it again later is safe: it only adds what is missing and keeps your loans.

---

## 8. Start the backend (Terminal 1)

Still in the same terminal:

```powershell
npm run dev
```

You should see a line starting **MOCK AUTHENTICATION: one-time codes are printed in THIS terminal…**, then a line of text containing **MiniLedger API listening** and `"port":4000`.

> **Leave this window open and do not type in it.** This is "Terminal 1". It is also where your **login code** appears later.

**Check it works:** open a web browser on the computer and go to <http://localhost:4000/api/health>. You should see something like:

```
{"data":{"status":"ok","database":"up","time":"…"}}
```

If you see `"database":"down"` or an error, go to [When something goes wrong](#12-when-something-goes-wrong).

---

## 9. Start the app on your phone (Terminal 2)

### 9a. Open a second terminal

Open **a new** PowerShell window in `C:\dev\MiniLedger\mobile` (open the `mobile` folder in File Explorer, type `powershell` in the address bar, press Enter). This is "Terminal 2". Do not close Terminal 1.

### 9b. Tell the app where the backend is (do this BEFORE starting the app)

The app has to be told the address of the backend **before** it starts, because it remembers the address when it starts. Run these two commands:

```powershell
adb reverse tcp:4000 tcp:4000
```
```powershell
Set-Content -Path .env -Value "EXPO_PUBLIC_API_URL=http://localhost:4000"
```

What they do, in plain words: the first lets your phone reach "port 4000" on your computer through the USB cable. The second saves the address `http://localhost:4000` for the app. The first command may print `4000` or nothing; an **error message** is the only bad sign.

> **Why this matters:** if you skip this, the app waits and then says **"The server took too long to respond"** when you try to sign in. That is the most common first-time problem.

### 9c. Start the app

Make sure the phone is plugged in and unlocked, then:

```powershell
npx expo start --android --clear
```

The first time, this takes a few minutes. It will:

1. Install an app called **Expo Go** on your phone (a "player" for apps that are still being built). If the phone shows a prompt, allow the install.
2. Build the app and open it in Expo Go on your phone.

You should see the **MiniLedger** sign-in screen with a box labelled **Mobile number**.

> **Leave Terminal 2 open too.** Closing it stops the app.

If the install of Expo Go does not happen by itself, install **Expo Go** from the Google Play Store and then run the same command again. (The Play Store version must be recent enough for this project; if the app refuses to open, use the automatic install from the command above.)

---

## 10. Use the app for the first time

### Sign in

1. Type any 10-digit number into **Mobile number**, for example `9876543210`. **No text message is sent**; this app uses a pretend login so you can try it without a real SMS service.
2. Tap **Send verification code**.
3. Now look at the **computer**, at **Terminal 1** (the backend window). A line like this has appeared:

```
[MiniLedger DEV OTP] +91••••••3210 -> 131084  (valid for 5 min)
```

The six digits after the `->` are your code (yours will be different). The phone number is partly hidden, so match it by its **last four digits**.

4. Type those six digits into the **Verification code** box and tap **Verify and sign in**.

The code works once, lasts 5 minutes, and you get 5 tries. If it stops working, tap *Resend* (you may have to wait 60 seconds) and use the **newest** code.

### Add a loan

1. You see three totals at the top (all ₹0.00) and "No loans yet". Tap **Add loan**.
2. Type the **friend's name** and the **amount** (for example `1500`).
3. Tap the **due date** to open the calendar and choose a day.
4. **Optional, a receipt photo:** tap **Take photo** (the first time, allow the camera when your phone asks) or **Choose from gallery**. A small preview appears. If you picked the wrong one, tap **Remove**.
5. Tap **Save loan**.

You go back to the home screen with the loan listed and the totals updated.

### Look at, add, change or remove a receipt later

- On a loan, tap **View receipt** (shown when it has a photo) or **Add receipt** (when it does not).
- On the receipt screen you can **take or choose another photo** to replace it, or tap **Remove receipt**.
- Photos must be JPEG, PNG or WebP and up to **5 MB**. If one is too big, the app tells you.

### Mark a loan as repaid

Tap **Mark repaid** on a loan, then confirm. It moves to **Repaid** and the totals change. This cannot be undone.

### See an overdue loan

Add a loan with a due date in the **past**. It appears with a red line and the words **Overdue · N days**, and the **Overdue** total includes it.

### Sign out

Tap **Sign out** at the top right.

---

## 11. Next time (the short version)

Your database, settings and loans are kept. To use the app again:

1. Plug in the phone (USB debugging stays on).
2. **Terminal 1:** open PowerShell in `C:\dev\MiniLedger\backend` and run `npm run dev`. Leave it open.
3. **Terminal 2:** open PowerShell in `C:\dev\MiniLedger\mobile` and run:

```powershell
adb reverse tcp:4000 tcp:4000
npx expo start --android
```

(`adb reverse` has to be repeated each time you unplug the cable or restart the computer.)

**To stop:** click in each terminal window and press **Ctrl + C**, then close the windows.

**If you are given a new version of the project:** put the new files in a new folder, copy your old `backend\.env` into its `backend` folder, and in the new `backend` folder run `npm install` and `npm run migrate:up`; in `mobile` run `npm install`, then start as usual. (Your database keeps your loans, because it lives in PostgreSQL, not in the project folder.)

---

## 12. When something goes wrong

Find the message you see, then do what the right-hand column says.

| What you see | What it means and what to do |
|---|---|
| **"The server took too long to respond"** in the app | The phone cannot find the backend. Check, in order: (1) Terminal 1 is still running `npm run dev`; (2) in Terminal 2 run `adb reverse tcp:4000 tcp:4000` again; (3) `mobile\.env` contains exactly `EXPO_PUBLIC_API_URL=http://localhost:4000`; (4) stop Terminal 2 (Ctrl + C) and start it again with `npx expo start --android --clear`. |
| **"Can't reach the server"** in the app | The same as above, but the connection failed at once instead of timing out. Same four checks. |
| `node` / `npm` / `npx` / `adb` **"is not recognized"** | The tool is not installed, or the terminal was opened before you installed it. Restart the computer, open a new terminal. For `adb`, redo step 2c. |
| **"running scripts is disabled on this system"** | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer **Y**, and retry (see step 3). |
| `adb devices` shows **unauthorized** | Unlock the phone and tap **Allow** on the "Allow USB debugging?" box. |
| `adb devices` shows **nothing** | Try another USB cable or port (some cables only charge), set the phone's USB mode to **File transfer**, and check USB debugging is on. |
| Backend stops with **"Invalid environment configuration"** | `backend\.env` is missing or still has placeholders. In `backend` run `npm run setup:env`. |
| `migrate:up` says **password authentication failed** or **database does not exist** | Step 5 was skipped or had a typo. Open **SQL Shell (psql)** again and redo the three `CREATE` lines. If one says "already exists", that one is fine. |
| **`ECONNREFUSED`** or the health page says `"database":"down"` | PostgreSQL is not running. Press the Windows key, type **Services**, open it, find **postgresql-x64-16**, right-click → **Start**. |
| **"address already in use"** / port 4000 | An older backend is still running. Close all PowerShell windows (or press Ctrl + C in them) and start Terminal 1 again. |
| No login code appears | Look in **Terminal 1** (the backend), not in the phone or Terminal 2. Use the **newest** one. If nothing appears at all, the app is not reaching the backend: see the first row. |
| **"Incorrect code"** / **"expired"** | Use the newest code. After 5 wrong tries or 5 minutes, request a new one. |
| **"Resend code in 42s"** | A built-in safety wait. Wait for the timer. |
| **"Camera access was not allowed"** | Allow the camera: phone *Settings → Apps → Expo Go → Permissions → Camera*. Or use **Choose from gallery**, which needs no permission. |
| **"That photo is too large"** | The limit is 5 MB. Take the photo from inside the app (it shrinks it) or choose a smaller one. |
| **"The receipt was not uploaded"** | Your loan **is** saved; only the photo failed (usually the connection). On the receipt screen tap **Try again**, or tap **Add receipt** on the loan later. |
| The receipt picture does not show ("Couldn't load the receipt photo…") | The message ends with the reason. Make sure Terminal 1 is still running, then tap **Try again**. If it keeps failing, look at Terminal 1 for a line mentioning `receipt` and send me that line. |
| The app shows a red or white screen | Look at Terminal 2 for the message. Try Ctrl + C, then `npx expo start --android --clear`. |
| The app returns to sign-in saying the session expired | That is normal after 7 days, or if you signed out elsewhere. Sign in again. |
| `npm install` fails | Check you are connected to the internet and in the right folder (`backend` or `mobile`). Run it again. Make sure Node is version 22 (`node --version`). |

Still stuck? More detail is in [docs/troubleshooting.md](docs/troubleshooting.md). When asking for help, send the **exact message** you see and the last 20 lines of Terminal 1. **Never send the `.env` file.**

---

## 13. On a Mac or Linux

The steps are the same, with these differences (these were **not** tested on a Mac):

- **Terminal:** open the *Terminal* app, then type `cd ` followed by the folder (you can drag the folder onto the Terminal window to fill in its path).
- **Install:** Node 22 from nodejs.org (or `brew install node@22`), and PostgreSQL 16 (`brew install postgresql@16` then `brew services start postgresql@16`).
- **Database (step 5)** instead of SQL Shell, run in Terminal: `psql postgres` then paste the three `CREATE` lines, then `\q`. (On Linux: `sudo -u postgres psql`.)
- **`adb`:** `brew install android-platform-tools`.
- **Mobile settings (step 9b)** use: `echo "EXPO_PUBLIC_API_URL=http://localhost:4000" > .env`
- Everything else (`npm install`, `npm run setup:env`, `npm run migrate:up`, `npm run dev`, `npx expo start --android --clear`) is identical.

### Without a USB cable (same Wi-Fi) *(not tested)*

You can instead connect over Wi-Fi. The phone and the computer must be on the **same** network (some guest or campus networks block this). Find the computer's address: Windows `ipconfig` (look for "IPv4 Address", like `192.168.1.23`), Mac `ipconfig getifaddr en0`. Then use that in step 9b instead of the `adb` and `localhost` lines:

```powershell
Set-Content -Path .env -Value "EXPO_PUBLIC_API_URL=http://192.168.1.23:4000"
```

(Replace the numbers with yours.) When Windows asks whether to let **Node.js** through the firewall, allow it for **Private networks**. The Expo Go from the Play Store must be recent enough for this project; if it is not, use the USB route above, which installs the right one for you.

---

## 14. Words explained

| Word | Plain meaning |
|---|---|
| **Terminal / PowerShell** | A window where you type commands instead of clicking. Every command here is copy and paste. |
| **Command** | One line you type, then press Enter. |
| **Folder path** | The address of a folder, like `C:\dev\MiniLedger`. |
| **Node.js** | A program that runs the backend and the helper tools. |
| **npm** | Comes with Node. Downloads the pieces (libraries) the project needs. `npm install` does that; `npm run something` runs a named job. |
| **Backend** | The program on your computer that the app talks to. It holds the rules (for example, who can see which loan). |
| **Database / PostgreSQL** | Where the loans, and receipt photos, are saved. |
| **Migration** | A small instruction that creates or changes the database's tables. `npm run migrate:up` runs them. |
| **`.env` file** | A private settings file. The backend one holds secret keys, so never share it. |
| **Expo / Expo Go** | The tool that builds the phone app and the "player" app on your phone that runs it while it is being built. |
| **OTP / verification code** | A one-time 6-digit code used to sign in. Here it is **pretend**: shown in Terminal 1 instead of being texted. |
| **`adb`** | A tool that talks to an Android phone over the cable. `adb reverse` lets the phone reach your computer. |
| **localhost** | "This same machine". With `adb reverse`, the phone's `localhost` reaches your computer. |
| **Port 4000** | The "door number" the backend listens on. |
| **Receipt photo** | An optional picture attached to a loan (JPEG, PNG or WebP, up to 5 MB). |

---

## 15. (Optional) Run the automated checks

These prove the code works; you don't need them to use the app. Open a terminal in each folder and run:

```powershell
cd C:\dev\MiniLedger\backend
npm test
```

At the end you should see **`Tests: 382 passed`**. (It uses the separate `miniledger_test` database, so your real loans are never touched.)

```powershell
cd C:\dev\MiniLedger\mobile
npm test
```

You should see **`Tests: 8 skipped, 327 passed`**. (The 8 skipped ones are an optional live check; they are skipped on purpose.)

---

## Where to read more

- [README.md](README.md): everything in detail (architecture, the API, security notes, known limitations).
- [docs/testing.md](docs/testing.md): exactly what was tested and what was **not** (the camera and gallery were not run on a device by the author).
- [docs/troubleshooting.md](docs/troubleshooting.md): longer fixes.
