# Northstar Athletic Club

Northstar is a responsive gym website and member portal built with React, Vite, Motion, Express, MongoDB, and Razorpay. It combines a public studio site with member accounts, class reservations, membership checkout, notifications, email support, and an admin dashboard.

## Features

### Public website
- Responsive, animated landing page for the club, classes, plans, amenities, and member reviews.
- Class schedule, membership pricing, coach and studio details, and contact links.
- Sign-up and sign-in dialogs with password visibility controls.

### Member accounts
- Email and password authentication with bcrypt password hashing and signed, HTTP-only session cookies.
- Rate-limited sign-in and sign-up, role-based access, and sign-out synchronization between browser tabs.
- Forgot-password and single-use password reset links that expire after 30 minutes.
- Member dashboard with an overview, class search, personal schedule, membership and billing, notifications, and profile settings.
- Capacity-aware class reservations and cancellations. Members can leave a review after attending a class.
- Profile editing, payment history, mark-all-read notifications, password reset requests, and account deletion.
- Account deletion stops active recurring subscriptions before removing the account. Payment records are retained without the member profile for audit history.

### Membership payments
- New membership purchases use Razorpay Standard Checkout with a backend-created order. Prices come from `server/config/plans.js`; the browser cannot choose an arbitrary amount.
- The backend verifies Razorpay's HMAC signature and confirms the payment is captured and matches the plan before activating access.
- Each successful order grants one month of membership. New order-based memberships renew manually; they do not auto-renew.
- Checkout locking and pending-order reuse reduce duplicate orders on repeated clicks or request retries. Repeated callbacks and webhook deliveries cannot grant the same period twice. A second captured payment against one order is recorded and logged for follow-up instead of extending the membership again.
- Signed Razorpay webhooks synchronize captured and failed payments. Older recurring subscriptions remain manageable through member billing controls, but new purchases use one-time orders.

### Admin dashboard
Open `/admin` after signing in with an admin account. The dashboard includes:
- Overview counts, recent members, payment activity, and recorded revenue.
- Member search and controls to pause or restore access.
- Class creation, editing, and cancellation.
- Booking review and attendance updates.
- Member reviews, memberships, and payment records.

### Email and notifications
- In-app notifications for membership and payment changes, class changes, cancellations, and account updates.
- Welcome and password-reset emails through SMTP. Email delivery is optional during development; without SMTP, account creation still works, but emails are not delivered.

## Technology
- **Frontend:** React 19, Vite, React Router, Motion, and Lucide icons.
- **Backend:** Node.js 20+, Express 5, Mongoose, Zod, and the Razorpay Node SDK.
- **Database:** MongoDB.
- **Operations:** Docker Compose, a production Dockerfile, and a Render Blueprint.

## Run locally

### Requirements
- Node.js 20 or newer and npm.
- MongoDB, either installed locally or run with Docker.

### 1. Configure environment variables
Copy `.env.example` to `.env` in the project root and set the required values:

```powershell
Copy-Item .env.example .env
```

At minimum, set:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/northstar
JWT_SECRET=your-random-secret-of-at-least-32-characters
```

Generate a random JWT secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

For Razorpay Test Mode, set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the root `.env`, using a matching key pair from the Razorpay dashboard. The secret stays on the backend; the frontend receives only the public Key ID needed to open Checkout. No `VITE_RAZORPAY_KEY_SECRET` variable is used.

Optional settings:

| Variable | Purpose |
| --- | --- |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies Razorpay webhook signatures. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Delivers welcome and password-reset emails. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Creates the initial admin account on startup if it does not already exist. |
| `APP_URL` | Public app origin used in email links and production settings. |

`.env` is excluded from Git and Docker build contexts. Do not commit it or put secrets in frontend environment variables.

### 2. Start MongoDB
For a local MongoDB installation, make sure the service is running and use the local `MONGODB_URI` above. Or start the bundled MongoDB container from the project root:

```powershell
docker compose up -d mongo
```

### 3. Install packages and start the app
From the project root in the VS Code terminal:

```powershell
npm ci
npm run dev
```

Open the Vite site at <http://localhost:5173>. The API listens on port `4000`, and Vite forwards `/api` requests to it. To stop both development servers, press `Ctrl+C` in that terminal.

On first startup, the app seeds a sample class schedule. If `ADMIN_EMAIL` and `ADMIN_PASSWORD` are configured, it also creates the initial admin account. Sign in through the website and visit <http://localhost:5173/admin>.

### Run the full app with Docker
Set `JWT_SECRET` in the root `.env`, then run:

```powershell
docker compose up --build
```

The container serves the built site and API at <http://localhost:4000>. Docker Compose starts MongoDB and stores its data in a named volume.

## Razorpay setup and testing
1. In the Razorpay Dashboard, switch to **Test Mode** and create a test Key ID and Key Secret under **Account & Settings → API Keys**.
2. Add the matching pair to the root `.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, then restart the backend.
3. Sign in, choose a membership plan, and complete a test payment in Standard Checkout. The backend verifies the signature and checks the captured amount before activating membership.
4. Enable automatic payment capture in the Razorpay Dashboard. The app does not activate a membership while a payment is only authorized and not captured.
5. For payment webhooks, register `https://YOUR_PUBLIC_HOST/api/payments/webhook`, set the matching webhook secret as `RAZORPAY_WEBHOOK_SECRET`, and subscribe to `payment.captured` and `payment.failed`. Add subscription events only if you still process older recurring subscriptions. Razorpay cannot send dashboard webhooks directly to localhost; use a temporary HTTPS tunnel for local webhook testing.
6. Use Live Mode only after the Razorpay account is activated and the Test Mode flow has been verified. Configure live credentials in the deployment provider's secret settings, not in source code.

## API overview
All application routes are under `/api`.

| Area | Routes |
| --- | --- |
| Health and plans | `GET /health`, `GET /plans` |
| Authentication | `POST /auth/signup`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`; `GET /auth/me` |
| Profile and account | `GET /profile`, `PATCH /profile`, `DELETE /account` |
| Classes and bookings | `GET /sessions`, `POST /sessions/:id/book`, `DELETE /sessions/:id/book`, `GET /me/bookings`, `POST /sessions/:id/reviews`, `GET /reviews` |
| Member tools | `GET /notifications`, `POST /notifications/read-all`, `GET /payments/history` |
| Razorpay Standard Checkout | `POST /create-order`, `POST /verify-payment`, `POST /payments/webhook` |
| Admin | `/admin/overview`, `/admin/members`, `/admin/classes`, `/admin/bookings`, `/admin/reviews`, `/admin/memberships`, `/admin/payments` |

Most member and admin routes require a signed-in account; admin routes additionally require the admin role.

## Deployment

### Render
The `render.yaml` file defines a Render Blueprint. Set the requested MongoDB URI, app URL, Razorpay credentials and webhook secret, SMTP settings, and initial admin credentials in Render's environment settings. The service builds the frontend, serves it from Express, and uses `/api/health` as its health check.

### Other Node hosts
Use Node.js 20 or newer. Run `npm ci`, `npm run build`, and `npm start`. Configure the same environment variables in the host's secret manager and use a managed MongoDB deployment with backups. The frontend and API should share an origin so the secure session cookie works as intended.

## Reliability checks
Run the automated checks with:

```powershell
npm test
npm run build
```

The reliability tests cover concurrent class reservations, retry-safe cancellations and bookings, payment activation idempotency, duplicate captured payments, webhook delivery retries, and payment status updates. They use in-memory model doubles and do not replace a staging payment with Razorpay Test Mode.

## Demo content to customize
Northstar's name, Chicago address, class schedule, coach names, amenities, and prices are sample content. Update the public page in `client/src/pages/HomePage.jsx`, plan prices and benefits in `server/config/plans.js`, and seeded class templates in `server/lib/seed.js` before adapting this project for a real gym.
