# Medical Clinic Queueing System - Local Setup Instructions

This guide will help you run the newly overhauled Queueing application on your local machine using a Local MySQL database. Firebase is no longer required!

## 1. Prerequisites
- **Node.js** installed on your machine.
- A Local **MySQL Server** installed and running on Port `3306`. (You can install this via applications like **XAMPP**, **WAMP**, or the standalone **MySQL Installer** for Windows).

## 2. MySQL Setup
1. Open your control panel (e.g., XAMPP Control Panel) or Services manager and ensure the **MySQL module is running**.
2. **No manual tables are required!** As long as the MySQL service is accepting root connections with an empty password (which is the default on Windows XAMPP environments), the application will automatically create the `clinic_db` database and all necessary tracking tables (`queue`, `clinic_state`, `announcements`) the first time it starts.

*Note: If your MySQL requires a password, open `database.js` and change the `password: ''` line to match your password.*

## 3. Running the Application Locally
1. **Install Dependencies**: Open a terminal in the project folder (`Attempt1`) and run:
   ```bash
   npm install
   ```
2. **Run the Server**: Now start the Node server which handles the API endpoints:
   ```bash
   node server.js
   ```
   *If successful, your console will output `Database connected successfully.` and `Server running at http://localhost:3000`.*

3. **Access the App**:
   - **Customer/Patient View**: [http://localhost:3000](http://localhost:3000)
   - **Admin View**: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

## 4. Features
- **Patient Dashboard**: Join a queue via dynamic AJAX, view live Wait Time and "People Ahead" metrics, ask queries to the Medical Chatbot.
- **Admin Dashboard**: Call next patient (automatically prioritizing Seniors, PWDs, and Pregnants over regulars), send broadcast announcements, toggle clinic hours, and view a live-updating bar chart.
