# Consent and Data Handling

Kuudu is a relaxing rhythm game. You steer a paper lantern with your breathing, measured from your
camera by the Presage SmartSpectra SDK. This page explains exactly what happens with your camera
and your data.

## Camera consent

- **The camera is off until you turn it on.** Before the camera starts for the first time in a
  session, a consent screen explains what is measured, why, where it happens and what is saved.
  The camera turns on only when you press **Start camera**. **Back** returns to the menu
  without turning it on.
- **You can always see it.** A **"Camera on"** badge with a pulsing dot stays on screen for the
  whole time the camera is on.
- **You can always stop it.** The badge's **Stop** button or the **Esc** key turns the camera off
  immediately, from any screen.
- **It turns itself off.** The camera stops at the end of every run, and when you close the app.
- **Only the player.** Kuudu measures the one person sitting in front of the screen who started
  the game. It is not designed for, and must not be used for, monitoring anyone else.

## What is measured, and why

Kuudu asks the SDK for **two** things only:

1. **The chest movement waveform** (`breathing.upperTrace`): the rise and fall of your chest. It
   moves the lantern up and down.
2. **The breathing rate** (`breathing.rate`): shown once, at the end of a run, as your pace next
   to the target pace.

The SDK also reports **camera checks** (for example "face not found" or "too dark"). Kuudu turns
them into on-screen hints and pauses the game until the view is clear.

## Where processing happens

Breathing is measured **on your computer** by the SmartSpectra SDK. Presage's documentation
describes the vitals as computed on-device. The SDK connects to Presage's service to authenticate
the app's API key and track usage.

## SDK telemetry

By default, the SmartSpectra SDK sends Presage diagnostic telemetry: session summaries and device
readiness reports. According to Presage's
[SDK Telemetry & Privacy](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/telemetry-and-privacy.md)
documentation, telemetry contains no video, images or measured breathing values, but it is
authenticated and can be linked to an account and device.

**Kuudu turns SDK telemetry off** (`enableTelemetry: false`). Per Presage's documentation, the SDK
then starts no telemetry session and transmits nothing.

## Storage and retention

- **Video and images are never recorded or saved**, by Kuudu or to disk.
- **Breathing data stays in memory during a run** (the waveform for the lantern and the ribbon,
  and the rate readings for your pace). It is discarded when you leave the end screen, press
  Stop/Esc, or close the app.
- **The only thing Kuudu saves** is your best score and the date you set it, one per game mode,
  in the app's local storage on your computer. For example: `{"drift": {"score": 1234, "date": "2026-11-13"}}`.
- Sound settings are not saved.

## Deletion

- **Settings → Reset data** deletes your saved scores, after a confirmation.
- Uninstalling the app removes everything it stored.

## Sharing

Kuudu shares nothing with anyone. It has no accounts, analytics, ads or tracking, and its code
contacts no server of its own. The only network connection is the SmartSpectra SDK's
authenticated connection to Presage, described above. Presage's handling of SDK sessions is covered
by [Presage's Privacy Policy](https://api.physiology.presagetech.com/privacypolicy).

## AI services

Kuudu uses **no AI or LLM services** at runtime. (The SmartSpectra SDK offers optional "insights"
from a language model. Kuudu never requests them.)

## Not a medical device

Kuudu is a relaxing rhythm game. It does not diagnose, treat or monitor any condition, and its
readings are used for gameplay only.

## Where to check this in the code

| Promise                                                  | Code                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Camera off until consent; consent text                   | [`src/renderer/ui/consent.ts`](../src/renderer/ui/consent.ts), [`src/renderer/main.ts`](../src/renderer/main.ts)         |
| "Camera on" badge and Stop                               | [`src/renderer/ui/camera-indicator.ts`](../src/renderer/ui/camera-indicator.ts)                                          |
| Only two metrics requested; telemetry off                | [`src/renderer/sdk.ts`](../src/renderer/sdk.ts)                                                                          |
| Camera only (no microphone), only for the app's own page | [`src/main/index.ts`](../src/main/index.ts)                                                                              |
| Only score and date saved; reset                         | [`src/renderer/storage.ts`](../src/renderer/storage.ts), [`tests/modes-storage.test.ts`](../tests/modes-storage.test.ts) |
| Breathing data discarded after a run                     | [`src/renderer/main.ts`](../src/renderer/main.ts) (`ribbon.clear()`, `paceReadings = []`)                                |
