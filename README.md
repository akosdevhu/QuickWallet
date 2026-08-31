# 📱 QuickWallet

**QuickWallet** is a lightning-fast, offline, and secure Android application designed to digitally store and organize your loyalty cards, coupons, barcodes, and QR codes.

Say goodbye to heavy plastic cards weighting down your physical wallet! With QuickWallet, all your loyalty cards are immediately accessible in one sleek and clean interface.

---

## ✨ Key Features

- **Instant Scanning:** Scan your physical cards using your device's camera, or import any barcode directly from a screenshot or image file.
- **Native Vector Rendering:** The application does not store blurry photos. Instead, it natively regenerates pixel-perfect barcodes (EAN-13, EAN-8, CODE-128, CODE-39, etc.) and QR codes to guarantee they can be scanned at any checkout counter.
- **App Linking (Smart Link):** Link an external application (e.g., Lidl, Tesco, SPAR) to your card and launch the official app with a single swipe directly from the back of the card.
- **Biometric Protection:** Keep your data secure by forcing fingerprint authentication or facial recognition (with PIN-code fallback) every time the app opens.
- **Backup & Restore:** Export all your cards into a single JSON file to your device or cloud storage, and restore them anytime you switch devices.
- **Themes & Styling:** Full dark mode support and an energy-saving, deep-black theme optimized for **AMOLED** displays.

---

## 🔒 Security & Privacy (Closed-Source)

QuickWallet is a **closed-source project** built with absolute user privacy in mind.

- **100% Offline Operation:** The application does not use external databases or transmit your card data to remote servers. All your information remains stored locally on your device in a secure, isolated storage configuration (`AsyncStorage`).
- **Zero Tracking:** The app contains no analytics software, third-party trackers, or advertisements.
- **Minimal Permissions:** The app only requests access to native features that are strictly necessary for its core functionalities (Camera for scanning barcodes, Biometrics for secure lock screen).

---

## 📥 Installation & Updates

Since this application is closed-source and distributed outside the official Google Play Store, you can always download the latest authentic build directly from this GitHub page.

### First-Time Installation:
1. Navigate to the **[Releases](https://github.com)** section on the right side of this repository.
2. Download the latest available **`.apk`** file (e.g., `QuickWallet_v0.5.0.apk`).
3. Open the downloaded file on your device and enable *"Install from Unknown Sources"* if your system prompts you.
4. If Google Play Protect displays a warning banner, click on **More details** and select **Install anyway**.

### Automatic Updates:
The application features a built-in **GitHub Releases API** client. On startup, it silently checks for new releases on this repository. If a newer version is available, it prompts you inside the app to download and install the update immediately.

---

## 🛠 Tech Stack

The application is built using a modern mobile development workflow:
- **Framework:** React Native & Expo SDK (EAS Build Workflow)
- **Core Packages:** Expo Camera, Expo Local Authentication, React Native SVG
- **Icons & Visual Anchors:** Lucide React Native Icons

---

© 2026 akosdevhu. All rights reserved.

License
All Rights Reserved  
This project is closed‑source.  
Only the APK is provided

---------------------------------

Contact

Developer: akosdevhu

Instagram: @akosdevhu
