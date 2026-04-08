# Customer Side Flowchart & Data Flow Guide

This guide breaks down the customer operations within the Medical Clinic Queueing System. You can use these flowcharts to understand the user journey and the underlying data flow between the frontend and the database.

## 1. Registration & Authentication Flow

This diagram illustrates how a customer enters the system, registers with AI-assisted ID verification, and logs into their dashboard.

```mermaid
flowchart TD
    Start((Start)) --> IndexPage[index.html Landing Page]
    IndexPage -->|Has Account| LoginBtn[Login]
    IndexPage -->|New User| RegisterBtn[Customer Registration]

    %% Registration Form
    RegisterBtn --> RegPage[register.html]
    RegPage --> UploadID[Upload Valid ID \nSenior/PWD/Regular]
    UploadID --> SubmitReg{Submit to /api/auth/register}
    SubmitReg -->|Trigger Mock AI| OCR[OCR / AI Service]
    OCR -->|Extract Data & Category| DB_Insert[(Users Table : Insert)]
    DB_Insert -->|Success| RegSuccess[Registration Complete]
    RegSuccess --> LoginPage

    %% Login Form
    LoginBtn --> LoginPage[login.html]
    LoginPage --> InputCreds[Enter Username/Password]
    InputCreds --> SubmitLogin{Submit to /api/users/login}
    SubmitLogin -->|Authenticate| DB_Check[(Users Table : Query)]
    DB_Check -->|Verify Role == 'customer'| GenToken[Generate JWT Token]
    GenToken --> Redirect[Redirect to customer.html]
    
    %% Error States
    SubmitLogin -->|Fail| ErrorMsg[Show Error Message]
    ErrorMsg --> LoginPage
```

---

## 2. Customer Dashboard & Core Actions Flow

Once logged in, the customer has three primary actions they can perform on their dashboard (`customer.html`).

```mermaid
flowchart TD
    Dashboard((Customer Dashboard)) --> Option1[Join Immediate Queue]
    Dashboard --> Option2[Book Appointment via Chatbot]
    Dashboard --> Option3[Scan QR Check-In]

    %% Option 1: Direct Queue
    Option1 --> SelectDept[Select Department from List]
    SelectDept --> AutoCat[Auto-Apply Customer Category \nRegular/Elderly/PWD]
    AutoCat --> SubmitQueue{POST /api/queue}
    SubmitQueue --> DB_Queue[(Queue Table : Insert)]
    DB_Queue --> ShowTicket[Update UI: Show Queue Ticket & Wait Time]

    %% Option 2: Booking via Chatbot
    Option2 --> OpenChat[Open Chat FAB]
    OpenChat --> SendMsg[Send Message: 'I want an appointment...']
    SendMsg --> NLP[Mock NLP Extraction]
    NLP --> SubmitAppt{POST /api/appointments}
    SubmitAppt --> DB_Appt[(Appointments Table : Insert)]
    DB_Appt --> ChatResponse[Chatbot Confirms Booking]

    %% Option 3: QR Check-In
    Option3 --> ScanQR[Click Scan QR to Check-In]
    ScanQR --> FetchAppt{GET /api/appointments}
    FetchAppt --> DB_FetchAppt[(Appointments Table : Query)]
    DB_FetchAppt --> DisplayAppt[Display Scheduled Appointments]
    DisplayAppt --> ClickCheckIn[Click Check-In on specific appointment]
    ClickCheckIn --> ConvertQueue{POST /api/appointments/checkin}
    ConvertQueue -->|Update Status| DB_ApptUpdate[(Appointments Table : Update)]
    ConvertQueue -->|Add to Queue| DB_Queue2[(Queue Table : Insert)]
    DB_Queue2 --> ShowTicket
```

---

## 3. Real-time Status Data Flow Diagram (DFD)

This diagram focuses strictly on the data exchange (Data Flow Diagram - Level 1) when the customer is actively waiting in the queue.

```mermaid
sequenceDiagram
    participant C as Customer View (patient.js)
    participant S as Server (server.js)
    participant DB as MySQL Database

    C->>S: GET /api/queue/status (Polling every 3s)
    S->>DB: SELECT current serving, waiting count
    DB-->>S: Return aggregated queue data
    S-->>C: JSON Queue Status
    C->>C: Update "Now Serving" UI
    C->>C: Update "Your Position" UI
    
    %% Broadcast Mechanism
    C->>S: GET /api/broadcast
    S->>DB: SELECT latest broadcast message
    DB-->>S: Return message
    S-->>C: JSON Broadcast string
    C->>C: Render scrolling marquee
```

> [!TIP]
> **How to Use:** You can copy the code blocks from this markdown file into a Mermaid Live Editor (like [mermaid.live](https://mermaid.live/)) to export them as PNG/SVG images for your documentation or presentations.
