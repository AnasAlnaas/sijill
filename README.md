# سِجِلّ — Sijill

A private notes app for Android, in Arabic and English. Everything lives on the phone; no account.

**Current version: 0.3.1** → `release/Sijill-0.3.1.apk`

---

## Install on your phone (Redmi Note 11)

1. Copy `release\Sijill-0.3.1.apk` to the phone (USB cable, Google Drive, Telegram "Saved messages", anything).
2. On the phone, open the file (Files app → Downloads). If asked, allow **"Install unknown apps"** for the app you opened it from.
3. MIUI may show a security scan or ask you to wait a few seconds; then tap **Install**.
4. Open **سِجِلّ**. When you set your first reminder, allow notifications.

### Make reminders reliable on Xiaomi (do this once)

Xiaomi stops background apps aggressively. Without these two steps a reminder can arrive late, or not until you open the app:

1. **Settings → Apps → Manage apps → سِجِلّ → Autostart → on.**
2. In the same screen: **Battery saver → No restrictions.**
   (Or inside Sijill: Settings → Advanced → *Battery settings*.)

Also: don't use MIUI's "clean"/rocket button on Sijill. A force stop cancels all alarms until the app is opened again (opening it re-arms everything).

### Dictation

- Tap the microphone in the middle of the bottom bar (or long-press the app icon → **Voice note**): a new note opens and starts listening at once. Speak; your words go into the note as they are recognised. Tap **Stop dictating** when done.
- Switch between **العربية** and **English** in the panel. Dictation stops by itself after about 20 seconds of silence, or when you leave the app. No audio is ever saved; only the text.
- **Online by default:** dictation uses Google’s online speech recognition, which is the most accurate (especially for Arabic). Your speech is sent to Google’s speech service to be turned into text; no audio is kept by Sijill.
- **No internet?** Sijill switches to the phone’s offline recogniser and tells you. That needs the offline packs: Settings → Google → (Search, Assistant & Voice) → Voice → *Offline speech recognition* → add **Arabic** and **English** (menu names vary slightly on Xiaomi).

### Checklists inside a note

In any note, tap the checklist-with-plus button in the bottom bar to add a checklist where the cursor is (on an empty line, above a line, or below it). Press Enter on an empty item to go back to normal text. Typing `- [ ] ` at the start of a line also makes a checklist item.

### Delete after a month

In a note, ⋮ → **Delete after a month**. A month later the note moves to Trash (recoverable for 30 more days). ⋮ → **Keep forever** cancels it.

### Swipe a card

On the main screen, swipe a card toward the end of the reading line to **archive** it (left in Arabic, right in English), or toward the start to move it to **Trash**. What will happen is written behind the card while you drag; let go early to cancel. Every swipe offers Undo.

### Monthly journal

Menu → **اليوميات / Journal**. The big button opens this month's entry (one note per month), creating it the first time; the **+** and microphone buttons on that screen do the same. Months follow your calendar setting (Hijri or Gregorian; "both" counts in Gregorian). Past months are listed by year, and each year can be exported as one PDF. Turn on the **monthly reminder** there to be nudged on a chosen day of each month. Journal entries stay out of the main Notes list; search still finds them.

## Update to a newer version

Install the new APK over the old one, exactly as above. Your notes stay.
Updates only work because every version is signed with the same key, kept in `D:\code\Sijill-keys`.
**Back that folder up** (see the READ ME FIRST file inside it).

Never uninstall to "fix" something without exporting first: uninstalling deletes the notes on the phone.

## Backups

- **Automatic, daily, inside the app** (last 14). These survive app updates, not uninstalling.
- **Backup folder** (Settings → Backups → Choose folder): a full .zip with attachments every day (last 5). Pick a folder such as `Documents/Sijill`; it survives uninstalling.
- **Export everything (.zip)**: one Markdown file per note + attachments + `sijill.json` (restorable).
- **Restore** never deletes anything: missing notes are added, older ones updated (the replaced version goes into history).

---

## For development

| | |
|---|---|
| Web app | `src/` (plain JavaScript, Vite). Pure logic in `src/core/` with tests in `test/`. |
| Android | `android/` (Capacitor 8). Our native code: `android/app/src/main/java/app/sijill/notes/`. |
| Preview in a browser | `npm run dev` → http://localhost:5180 (`?gray` simulates grayscale) |
| Tests | `npm test` (unit tests + 7:1 contrast check of every theme × accent) |
| Release APK | `npm run sync`, then in `android/`: `gradlew assembleRelease` (needs JDK 21) |
| Icon options | `design/icons.html`; regenerate with `scripts/icons.js` |

Fonts (SIL Open Font License, bundled in `public/fonts/`): IBM Plex Sans Arabic, IBM Plex Sans, Noto Naskh Arabic, Noto Serif, Amiri.
