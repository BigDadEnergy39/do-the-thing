# Security Notes — Do The Thing

A short, honest record of this app's security posture, the decisions behind it,
and the rules future changes should follow. "Do The Thing" is an **offline,
local-only** Android app: no backend, no network, no accounts. All data lives in
a local SQLite database on the device.

## Threat model

Attackers considered (there is no remote attacker — there is no server):

1. **Another app on the same device** — exported components, the custom
   deep-link scheme, shared file URIs.
2. **Physical access / the device backup channel** — can data be extracted?
3. **A malicious or corrupt file** the user is tricked into importing via the
   backup/restore feature.

## Posture and decisions

### Data at rest — *accepted risk* (LOW-1)

The SQLite DB and JSON backups are stored **unencrypted** in app-private
storage.

- `android:allowBackup="false"` (`app.json` + `src/main/AndroidManifest.xml`)
  blocks `adb backup` and cloud auto-backup extraction.
- The data is personal tasks/habits — **no credentials, tokens, or third-party
  PII** — so residual risk is limited to an attacker with **root**, or a
  physical unlock combined with a **debuggable** build.
- We **accept** this rather than adopt SQLCipher, which adds build/native
  complexity and F-Droid friction for little benefit given the data class.
- **Revisit** if the app ever stores secrets or sensitive personal data.
- **Exception:** if the user opts into a durable backup folder, unencrypted
  backups also leave app-private storage — see *Durable off-device backups* below.

### Permissions — least privilege (INFO-2)

Every declared permission maps to a feature:

| Permission | Why |
|---|---|
| `POST_NOTIFICATIONS`, `VIBRATE` | local notifications |
| `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK` | re-arm scheduled alarms after reboot |
| `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM` | exact-time deadline/coaching reminders via `AlarmManager` `allowWhileIdle`. Inexact alarms drift and would miss user-set times. **F-Droid:** a legitimate use; documented here for reviewers. |
| `INTERNET` | pulled in transitively by `expo-file-system`; **stripped from release** (`src/release/AndroidManifest.xml`) and enforced by the build guard below |

### Build / distribution integrity

- Release builds sign from a **gitignored** `android/keystore.properties` (a real
  key), never the public Android debug key. See `keystore.properties.example`.
- A Gradle guard in `android/app/build.gradle` **fails the release build** if the
  packaged manifest ever contains `allowBackup="true"` or the `INTERNET`
  permission — defence against a stale or dependency-widened manifest shipping.

### Backup / restore

- Import **validates shape and version before** the destructive wipe, **caps
  input size** (OOM defence), and writes a **pre-import snapshot**
  (`dtt-preimport-*.json`) so a valid-but-unwanted import is recoverable.
- `restoreRows` keeps values **parameterised** and gates the interpolated table
  and column identifiers behind an explicit allowlist + identifier check.
- `restoreFromPrivateFile` accepts **only** names matching an anchored
  `dtt-backup-…json` regex before interpolating them into a path — no traversal.
- Backups are **append-only**: each write is a unique timestamped file that never
  overwrites or deletes an earlier one; old files age out by retention window
  only. Pruning (private 7-day, durable 30-day) deletes **only** files matching
  the `dtt-backup-*.json` pattern, never other files in a user's folder.

### Durable off-device backups — *plaintext, user-initiated* (LOW-3)

The user may grant a folder (SAF) that the daily task also writes to, so backups
survive uninstall. Those JSON backups are **unencrypted**, like the in-app ones.

- If the chosen folder is **cloud-synced** (Nextcloud, Syncthing) or otherwise
  readable by other apps, task names and notes leave the device **in the clear**.
- This is **opt-in and user-chosen**; the app cannot control the folder's own
  access. We **inform** at the point of consent (a caution in the folder-set
  confirmation and the Backup section copy) rather than encrypt.
- **Revisit** with optional passphrase-encrypted backups if users store genuinely
  sensitive content — the notification-privacy toggle (`private_notifications`)
  hardened one surface; encrypted backups would harden the other.

## Rules for future changes

- Keep `allowBackup="false"`. Keep `INTERNET` out of release unless the app gains
  a genuine network feature — and if so, document it here.
- Any new exported component or deep-link route must **validate its inputs**.
- Any new Android permission must be **justified in this file**.
- The client stays **offline**: no analytics, trackers, or proprietary SDKs
  (F-Droid requirement).
- Database changes go through the schema/migrations in `src/db/schema.js`; the
  repo stays authoritative.
