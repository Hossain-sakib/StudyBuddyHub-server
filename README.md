# StudyBuddy API

Node 24, npm 11. Install with `npm ci`, then `npm start` (port 5000).

Development uses an ignored `.local/workspace.json` file with accounts, individual learning progress, personal assignments, and shared study-room messages. Passwords are hashed with scrypt and a unique salt. A random development signing key is used if ACCESS_TOKEN_SECRET is absent; restarting then invalidates sessions while preserving accounts. Set a stable 32+ character secret through environment settings to preserve sessions. Never commit credentials.

Production requires NODE_ENV=production, a 32+ character ACCESS_TOKEN_SECRET, MONGODB_URI, and CLIENT_ORIGINS (comma-separated exact frontend origins). MongoDB connection, ping and index creation must succeed before the HTTP server starts. Production requires HTTPS; cookies are Secure, HttpOnly and SameSite=Lax. Serve the frontend and `/api` through the same origin using a reverse proxy. Do not expose development file storage as a production database. Local-file mode is for a single server process.

The Vite client proxies `/api` to this server in development. No Firebase credentials are required by the new platform. Existing legacy Firebase-based client pages are retained as source but are not the active entry point. The new API replaces the legacy public assignment endpoints; existing production data requires a deliberate migration before rollout.

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

Quizzes are self-guided practice and scores are learner-managed, not secure examination results. Assignments include personal tasks and community challenges, with author-only edits/deletion, private submissions, peer grading and feedback. Community delivery uses polling. No email verification, password recovery, moderation dashboard, or learning-management administration is included yet. These must be addressed before a public production launch.

Run API integration tests with `node --test tests/api.test.js`. They use isolated temporary storage and do not touch real account data.

Vercel uses serverless.js to initialize MongoDB before routing requests. Production settings must be supplied there as well. Serverless hosting itself has not been exercised in this workspace.

## Administration and media

ADMIN_EMAIL designates the bootstrap administrator. This role is assigned only after cryptographically verified Google sign-in for that exact email; password registration cannot claim it. Every admin endpoint rechecks the database-backed role. Modules: users, course metadata/first lesson and quiz editing, CMS pages, CRM contacts/leads, tasks, inventory, employees, invoices, moderation, activity logs and exports. Invoices store integer minor-unit amounts; this is not a certified accounting or payroll engine. Keep legal/tax/accounting workflows under a separate reviewed specification.

Cloudinary handles binary file storage; MongoDB stores metadata only. Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (or CLOUDINARY_URL) in runtime settings. The SDK secret signs requests on the backend and is never sent to browsers. Uploads are admin-only, capped at 3 MB, and checked against PNG/JPEG/WebP/PDF signatures. Public uploads are restricted to images. Private file access is authorized before issuing a short-lived download URL. GridFS is not used. End-to-end provider upload/download testing requires the Cloudinary account settings and credentials; PDF delivery may require enabling that asset type in the Cloudinary account.

SEED_SAMPLE_CONTENT=true inserts starter courses, sample challenges and labeled discussion prompts with insert-only upserts and a completion marker. It preserves existing records. Disable after confirming the initial seed.

Known release limits: no independent penetration test, malware-scanning service, disaster-recovery rehearsal, email recovery flow, or accounting/payroll certification. Dependency audit results are point-in-time evidence, not a guarantee of no vulnerabilities. Do not describe this application as risk-free.
