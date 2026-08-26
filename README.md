# 🌶️ Spicy Spoon — Restaurant Management & Guest Dining System

> **A full-stack restaurant management platform featuring zero-login guest dining, visual table booking, multi-round dine-in ordering, live billing, payment settlement, Kitchen Display System (KDS), and Admin operations with Role-Based Access Control (RBAC).**

---

## 🌟 Architecture Overview

Spicy Spoon cleanly separates **Public Guest Customer Access** (100% login-free) from **Internal Staff Operations** (Role-Based Access Control):

```text
                           SPICY SPOON
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              ▼                                   ▼
       PUBLIC CUSTOMER                       STAFF SYSTEM
      (No Login Required)                  (Login Required)
              │                                   │
      ┌───────┼────────┐                 ┌────────┴────────┐
      │       │        │                 │                 │
      ▼       ▼        ▼                 ▼                 ▼
    HOME    MENU    BOOK TABLE          ADMIN            KITCHEN
      │       │        │               LOGIN              LOGIN
      │       │        │                 │                 │
      │       │        ▼                 ▼                 ▼
      │       │     TABLE MAP        ADMIN DASHBOARD      KDS
      │       │        │                 │                 │
      │       │        ▼          ┌──────┼──────┐          │
      │       │     BOOKING        │      │      │          │
      │       │        │           ▼      ▼      ▼          │
      │       │        ▼         Tables Bookings Reports    │
      │       │    GUEST SESSION          │                 │
      │       │        │                  ▼                 │
      │       └────────┤               Payments             │
      │                │                  │                 │
      │                ▼                  ▼                 │
      │             ORDERS            QR Manager            │
      │                │                  │                 │
      │                ▼                  ▼                 │
      │             LIVE BILL           Staff               │
      │                │                                    │
      │        ┌───────┼────────┐                           │
      │        ▼       ▼        ▼                           │
      │       UPI    CARD      CASH                         │
      │        │       │        │                           │
      │        └───────┼────────┘                           │
      │                ▼                                    │
      │          DIGITAL RECEIPT                            │
      │                                                     │
      └─────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features

### 🍽️ 1. Public Guest Customer Experience (No Login Required)
- **Luxury Landing Page**: Hero, Our Story, Menu Specialities, and Contact information.
- **Visual Table Booking**: 12 tables mapped across 4 sections (*Main Hall*, *Window Side*, *Outdoor Patio*, *VIP Lounge*). Date, time slot, and party size filtering with real-time capacity validation and double-booking collision prevention.
- **Table QR Entry**: Direct QR scanning detects the table number and attaches the user to a temporary guest dining session.
- **Guest Session Dashboard**: Live order timeline (*Placed* → *Cooking* → *Ready* → *Served*), aggregated bill breakdown, and quick actions.
- **Multi-Round Menu Ordering**: Submit Round 1 (Starters), Round 2 (Mains), Round 3 (Desserts) under a single dining session with special chef instructions.
- **Live Invoicing & Settlement**: Server-authoritative calculations with 5% GST and 2.5% Service Charge, coupon discounts (`SPICY10`), UPI QR code generation, Card simulation, and Cash settlement requests.
- **Digital Receipt**: Verified transaction receipts with one-click print support.

### 🔒 2. Internal Staff Operations & RBAC
- **Unified Staff Login**: Authenticate as `ADMIN` or `KITCHEN` with bcrypt password hashing and signed JWT tokens.
- **Admin Management Suite**:
  - Live Floor Map with table state overrides (`AVAILABLE`, `RESERVED`, `OCCUPIED`, `PAYMENT_PENDING`).
  - Table Reservations Management & Check-in.
  - Live Invoicing & Cash payment confirmation.
  - Menu dish management (availability, price, categories).
  - Permanent master QR stand & table QR generator with PNG download.
  - Revenue analytics and payment method breakdown.
  - Staff user management (create, activate, deactivate staff accounts).
- **Kitchen Display System (KDS)**:
  - 4 Touch-friendly order lanes: `1. NEW ORDERS`, `2. QUEUED / ACCEPTED`, `3. COOKING IN KITCHEN 🔥`, `4. READY FOR SERVICE 🍽️`.
  - Real-time order expediting with WebSocket sync and special dietary instruction highlights.

---

## 🔑 Default Staff Credentials

| Role | Username | Password | Access Level |
|---|---|---|---|
| **ADMIN** | `admin` | `admin123` | Full Operations, Floor Map, Reports, Cash, Staff Management |
| **KITCHEN** | `kitchen` | `kitchen123` | Kitchen KDS, Order Status Transitions (`ACCEPTED` → `PREPARING` → `READY` → `SERVED`) |

---

## 🛠️ Tech Stack

- **Frontend**: React, Vite, Vanilla CSS Design System, Lucide Icons, Canvas Confetti.
- **Backend**: Node.js, Express, SQLite (`node:sqlite` / `DatabaseSync`), WebSockets (`ws`), JWT (`jsonwebtoken`), Bcrypt (`bcryptjs`).

---

## 💻 Getting Started

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd spicy-spoon
```

### 2. Backend Setup
```bash
cd backend
npm install
node server.js
```
*Backend runs on `http://localhost:5000` with WebSocket server on `ws://localhost:5000`.*

### 3. Frontend Setup
```bash
cd ../frontend
npm install
npm run dev
```
*Frontend runs on `http://localhost:5173`.*

---

## 🧪 Testing

Run the automated test suites in `backend/`:

```bash
# Test Role-Based Access Control and Guest Architecture
node backend/test-rbac-suite.js

# Test End-to-End Multi-Round Ordering, Invoicing, Table Lock & Payment Idempotency
node backend/test-suite.js
```

---

## 📄 License
MIT © 2026 Spicy Spoon
