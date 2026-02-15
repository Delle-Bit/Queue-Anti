# Medical Clinic Queueing System - Setup Instructions

## 1. Prerequisites
- Node.js installed.
- A Firebase Project (Create one at [console.firebase.google.com](https://console.firebase.google.com/)).

## 2. Firebase Setup
1.  **Create Project**: Go to Firebase Console and create a new project.
2.  **Enable Firestore**:
    -   Go to **Firestore Database** -> **Create Database**.
    -   Start in **Test Mode** (for now).
3.  **Get Client Config**:
    -   Go to **Project Settings** -> **General** -> **Your apps** -> **Web App**.
    -   Copy the `firebaseConfig` object.
4.  **Update Code**:
    -   Open `public/patient.js` and `public/admin.js`.
    -   Replace the `firebaseConfig` placeholder with your actual keys.

## 3. Run Locally
1.  **Install Dependencies** (if not already done):
    ```bash
    npm install
    ```
2.  **Start Server**:
    ```bash
    node server.js
    ```
3.  **Access the App**:
    -   **Patient View**: [http://localhost:3000](http://localhost:3000) (or `/index.html`)
    -   **Admin View**: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

## 4. Features
-   **Patient**: Join queue (Regular, Senior, PWD, Pregnant), Chat with AI (mocked), Receive Announcements.
-   **Admin**: Call Next (Priority Support), Reset Queue, Toggle Clinic Status, View Dashboard.
