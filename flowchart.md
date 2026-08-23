# Customer Side Flowchart & Data Flow Guide

This guide breaks down the customer operations within the Medical Clinic Queueing System. You can use these flowcharts to understand the user journey and the underlying data flow between the frontend and the database.

## 1. Registration & Authentication Flow

There is no separate `register.html`/`login.html` — everything happens in an auth-panel overlay on `index.html`. Registration is a 4-step wizard with OCR-assisted ID verification.

```mermaid
flowchart TD
    Start((Start)) --> IndexPage[index.html Landing Page]
    IndexPage -->|Sign In| LoginTab[Auth Overlay: Login Tab]
    IndexPage -->|Sign Up| RegTab[Auth Overlay: Register Tab]

    %% Registration Wizard (4 steps)
    RegTab --> Step1[Step 1: Upload Front/Back ID \nor Guardian Info if underage]
    Step1 --> SubmitStep1{POST /api/auth/register/step1}
    SubmitStep1 -->|OCR scan of ID| OCR[AI OCR Service \nfalls back to local mock]
    OCR -->|Detect category/name/birthday| PendingInsert[(pending_registrations : Insert)]
    PendingInsert --> Step2[Step 2: Create Password]
    Step2 --> SubmitStep2{POST /api/auth/register/step2}
    SubmitStep2 --> Step3[Step 3: Send Verification Code]
    Step3 --> SubmitStep3{POST /api/auth/register/send-verification}
    SubmitStep3 -->|Mock email w/ OTP| Step4[Step 4: Enter OTP]
    Step4 --> SubmitStep4{POST /api/auth/register/verify-otp}
    SubmitStep4 -->|Correct OTP| UserInsert[(users Table : Insert, category=Regular/Senior/PWD)]
    UserInsert --> RegSuccess[Registration Complete] --> LoginTab

    %% Login Form
    LoginTab --> InputCreds[Enter Username/Password]
    InputCreds --> SubmitLogin{POST /api/auth/login}
    SubmitLogin -->|Authenticate| DB_Check[(users Table : Query)]
    DB_Check -->|bcrypt compare + role lookup| GenToken[Generate JWT Token, 8h expiry]
    GenToken --> Redirect[Redirect by role: \ncustomer -> customer.html \nfrontdesk/laboratory/doctor -> their page \nadmin/admintechnical -> admintechnical.html \nowner -> owner.html]

    %% Error States
    SubmitLogin -->|Fail| ErrorMsg[Show Error Message]
    ErrorMsg --> LoginTab
```

---

## 2. Customer Dashboard & Core Actions Flow

Once logged in, the customer has three primary actions on their dashboard (`customer.html`), plus a voice-driven Virtual Nurse Assistant that can trigger the first and third.

```mermaid
flowchart TD
    Dashboard((Customer Dashboard)) --> Option1[Join a Service Queue]
    Dashboard --> Option2[Book an Appointment]
    Dashboard --> Option3[QR Check-In]
    Dashboard --> VA[Talk to Virtual Nurse Assistant]

    %% Option 1: Join a service package queue
    Option1 --> BrowseServices[Browse Services tab, pick a package]
    BrowseServices --> MedGate1{Medical form complete?}
    MedGate1 -->|No| MedForm[Mandatory Medical Form Modal]
    MedGate1 -->|Yes| Preview{GET /api/queue/preview-package/:id}
    Preview --> ShowPreview[Show ticket preview: ETA, station sequence]
    ShowPreview --> ConfirmQueue{POST /api/queue/start-package}
    ConfirmQueue --> DB_Seq[(queue_sequences + queue Table : Insert)]
    DB_Seq --> SocketEmit1(( io.emit 'queueUpdate' ))
    SocketEmit1 --> ShowTicket[Dashboard shows ticket + live position]

    %% Option 2: Book an appointment
    Option2 --> MedGate2{Medical form complete?}
    MedGate2 -->|No| MedForm
    MedGate2 -->|Yes| PickSlot[Pick date from calendar + time slot]
    PickSlot --> SubmitAppt{POST /api/appointments}
    SubmitAppt -->|Slot free & date not full| DB_Appt[(appointments Table : Insert, w/ qr_token)]
    DB_Appt --> ApptConfirmed[Appointment Confirmed]

    %% Option 3: QR Check-In
    Option3 --> ScanQR["Scan the appointment's QR (qr_token)"]
    ScanQR --> CheckinPage[GET /checkin/:token \npublic confirmation page]
    CheckinPage --> ConvertQueue{POST /api/appointments/check-in}
    ConvertQueue -->|Update status=checked-in| DB_ApptUpdate[(appointments Table : Update)]
    ConvertQueue -->|Promote to queue via package sequence| DB_Seq
    DB_Seq --> ShowTicket

    %% VA voice assistant
    VA --> Speak[Speak a request: FAQ, price calc, or 'join the queue for X']
    Speak --> Dialogue{POST /api/assistant/dialogue}
    Dialogue -->|intent=queue_action, resolved package| ConfirmQueue
    Dialogue -->|intent=faq/calculation| VAReply[Spoken reply, grounded in live package/queue data]
```

---

## 3. Real-time Status Data Flow Diagram (DFD)

Live updates are push-based over Socket.IO, not client polling. Any staff action that mutates the queue emits a `queueUpdate` event; the customer dashboard listens and re-fetches its own status.

```mermaid
sequenceDiagram
    participant C as Customer View (customer.js)
    participant S as Server (server.js + routes/queue.js)
    participant DB as MySQL Database (clinic_v2)
    participant Staff as Staff Action (frontdesk/laboratory/doctor)

    Staff->>S: e.g. POST /api/queue/next or /complete-step
    S->>DB: UPDATE queue / queue_sequences
    S-->>S: req.app.get('io').emit('queueUpdate', {})
    S-->>C: Socket.IO push: 'queueUpdate'
    C->>S: GET /api/queue/my-status (on event, not on a timer)
    S->>DB: buildCustomerStatus() - position, ETA, current station
    DB-->>S: Return live queue state
    S-->>C: JSON queue status
    C->>C: Re-render ticket, position, ETA, station track

    %% Virtual Nurse Assistant grounds its answers in the same live state
    C->>S: POST /api/assistant/dialogue {text, history}
    S->>S: buildCustomerStatus() (shared with /my-status)
    S-->>C: {reply, intent, action}
    C->>C: Speak reply, optionally trigger queue-join confirm flow
```

> [!TIP]
> **How to Use:** You can copy the code blocks from this markdown file into a Mermaid Live Editor (like [mermaid.live](https://mermaid.live/)) to export them as PNG/SVG images for your documentation or presentations.
