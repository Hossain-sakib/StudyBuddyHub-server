# StudyBuddy API

Node 24, npm 11. Install with `npm ci`, then `npm start` (port 5000).

Development uses an ignored `.local/workspace.json` file with accounts, individual learning progress, personal assignments, and shared study-room messages. Passwords are hashed with scrypt and a unique salt. A random development signing key is used if ACCESS_TOKEN_SECRET is absent; restarting then invalidates sessions while preserving accounts. Set a stable 32+ character secret through environment settings to preserve sessions. Never commit credentials.

Production requires NODE_ENV=production, a 32+ character ACCESS_TOKEN_SECRET, MONGODB_URI, and CLIENT_ORIGINS (comma-separated exact frontend origins). MongoDB connection, ping and index creation must succeed before the HTTP server starts. Production requires HTTPS; cookies are Secure, HttpOnly and SameSite=Lax. Serve the frontend and `/api` through the same origin using a reverse proxy. Do not expose development file storage as a production database. Local-file mode is for a single server process.

The Vite client proxies `/api` to this server in development. Password authentication uses the API. Google sign-in requires FIREBASE_PROJECT_ID and the public Firebase web configuration in the frontend. Legacy client screens have been removed. The new API replaces the legacy public assignment endpoints; existing production data requires a deliberate migration before rollout.

Endpoints:
- GET /api/health, /api/courses
- POST /api/auth/register, /api/auth/login, /api/auth/logout
- GET /api/session
- PUT /api/state (authenticated, validated learner workspace)
- GET /api/messages?room=general|design|development
- POST /api/messages {room,text} (authenticated)
- GET/POST /api/assignments; PUT/DELETE /api/assignments/:id (author only)
- POST /api/assignments/:id/submissions (learner)
- PATCH /api/assignments/:id/submissions/:userId (author grading)

Quizzes are self-guided practice and scores are learner-managed, not secure examination results. Assignments include personal tasks and community challenges, with author-only edits/deletion, private submissions, peer grading and feedback. Community delivery uses polling. Password sign-in supports optional email verification and single-use email recovery after an email provider is configured. Administrator modules provide moderation and learning-content management. These must be addressed before a public production launch.

Run API integration tests with `node --test tests/api.test.js`. They use isolated temporary storage and do not touch real account data.

Netlify uses netlify/functions/api.js to initialize MongoDB before routing requests. Production settings must be supplied in Netlify runtime environment variables. Readiness failures return credential-safe diagnostic codes.

## Administration and media

ADMIN_EMAIL designates the bootstrap administrator. This role is assigned only after cryptographically verified Google sign-in for that exact email; password registration cannot claim it. Every admin endpoint rechecks the database-backed role. Modules: users, complete course, lesson and quiz editing, CMS pages, CRM contacts/leads, tasks, inventory, employees, invoices, moderation, activity logs and exports. Invoices store integer minor-unit amounts; this is not a certified accounting or payroll engine. Keep legal/tax/accounting workflows under a separate reviewed specification.

Cloudinary handles binary file storage; MongoDB stores metadata only. Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (or CLOUDINARY_URL) in runtime settings. The SDK secret signs requests on the backend and is never sent to browsers. Uploads are admin-only, capped at 3 MB, and checked against PNG/JPEG/WebP/PDF signatures. Public uploads are restricted to images. Private file access is authorized before issuing a short-lived download URL. GridFS is not used. End-to-end provider upload/download testing requires the Cloudinary account settings and credentials; PDF delivery may require enabling that asset type in the Cloudinary account.

SEED_SAMPLE_CONTENT=true inserts 174 labeled demo records: 18 courses, 36 challenges, 30 discussion prompts, 20 contacts, 15 leads, 15 tasks, 12 inventory items, 10 employees, 12 invoices and 6 CMS pages. Insert-only upserts and a completion marker make retries safe. It preserves existing records. Disable after confirming the initial seed.

Known release limits: no independent penetration test, malware-scanning service, disaster-recovery rehearsal, or accounting/payroll certification. Dependency audit results are point-in-time evidence, not a guarantee of no vulnerabilities. Do not describe this application as risk-free.

## In-app notifications

GET /api/notifications returns the authenticated user's latest 50 notifications and total unread count. PATCH /api/notifications/read marks all their notifications read; PATCH /api/notifications/:id marks one owned record. Cross-user records are inaccessible. Events use unique per-user keys to prevent duplicates. Indexes support inbox queries and event uniqueness.

Events include welcome, personal-task due reminders, quiz results, course completion, new assignment submissions and grading feedback. Due reminders are derived when the inbox refreshes, using UTC dates. Optional email delivery is supported for verified accounts that opt in; browser push is not included. Reminders are generated on inbox refresh, rather than by an unattended scheduler.

Run npm test for isolated API integration, seed repeatability, notification privacy and event checks. Regenerate the deterministic demo fixtures with node scripts/generate-demo-content.cjs; keep the frontend catalog synchronized if changing courses.

## Recovery and email delivery

Configure either Gmail/SMTP or Resend, plus MAIL_FROM and APP_URL=https://studybuddy-hub.netlify.app. Gmail does not require a custom domain. For Gmail use SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER=your Gmail address, SMTP_PASS=a Google app password, and MAIL_FROM=Studybuddy <your Gmail address>. Create the app password in Google Account → Security → 2-Step Verification → App passwords. Never use the normal Google account password. SMTP supports port 465 with implicit TLS or 587 with required STARTTLS and certificate validation. If SMTP is fully configured it takes priority over Resend. For Resend use RESEND_API_KEY and a sender on a domain verified in Resend (API Keys and Domains sections). No email is sent until these settings exist. The provider key stays server-side. No new mail dependency is required.

POST /api/auth/forgot-password returns the same message for eligible and unknown accounts. Reset and verification tokens are 32 random bytes, stored only as SHA-256 hashes, expire after 30 minutes and are consumed once. Issuance has a per-account cooldown as well as IP rate limiting. POST /api/auth/reset-password changes a scrypt password and increments the session version, invalidating prior sessions. Google accounts retain Google sign-in; recovery does not add a password to them.

POST /api/account/verification sends an authenticated verification request; POST /api/auth/verify-email consumes it. PATCH /api/account/preferences controls email notifications, which require a verified email. In-app notifications persist independently. Email notifications are best-effort immediate delivery; failures do not roll back the in-app inbox and there is no durable retry queue in this release. Email-provider tests use a mocked transport until real credentials are supplied.

## Administration workflows and CMS

Courses support up to 50 lessons and 50 quiz questions. Validation checks every lesson and answer. To preserve existing learner progress, structural edits that shift existing lesson positions or change quiz length are rejected once progress exists; create a new course for those changes. Text and metadata can still be improved.

POST /api/admin/leads/:id/convert creates one deterministic contact per lead and marks the lead won. POST /api/admin/inventory/:id/adjust applies a bounded integer stock change atomically in MongoDB, rejects negative stock and records the reason in the audit log. Admin summaries and filters support operational follow-up. These remain record-management workflows, not certified finance/payroll software.

GET /resources/:slug serves published CMS records as escaped HTML with article metadata, canonical URLs and JSON-LD. GET /sitemap.xml reads only published pages. Drafts return 404. Deployment packaging supplies the compiled Tailwind stylesheet path through generated data/page-assets.json. No React boot is needed to read an article.

Administrator account disabling increments the session version. Re-enabling an account allows fresh sign-in but never restores its older sessions. The administrator cannot disable their own account.

Gmail delivery remains a real-provider release check until SMTP_PASS is supplied in Netlify. SMTP tests use a mocked transport; they verify routing, required TLS and cleanup rather than claiming a real email was delivered.

## Public rendering and speed

public-routes.js handles crawlable course/article URLs and the published-only sitemap. public-pages.js owns shared escaping, metadata and the server-rendered HTML shell. Public course summaries use GET /api/catalog; lesson bodies and quiz payloads are omitted. The learner workspace continues using GET /api/courses. JSON API responses carry X-Robots-Tag: noindex.

Course detail and CMS detail requests use indexed lookups. Independent startup index checks run concurrently. Public pages remain immediately database-backed; private account responses are never cached.
