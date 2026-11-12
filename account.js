const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const mail = require("./mailer");
const digest = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
const generic = {
  message:
    "If this address has an eligible account, a recovery email will arrive shortly. Google accounts should use Google sign-in.",
};
module.exports = function accountRoutes(
  app,
  { authenticated, handle, rateLimit, storage, persist, findUser },
) {
  async function update(query, values, incrementVersion = false) {
    const { db, fileData } = storage();
    if (db)
      return (
        (
          await db
            .collection("users")
            .updateOne(query, {
              $set: values,
              ...(incrementVersion ? { $inc: { sessionVersion: 1 } } : {}),
            })
        ).matchedCount > 0
      );
    const user = fileData.users.find((u) =>
      Object.entries(query).every(([key, value]) =>
        value && typeof value === "object" && "$exists" in value
          ? (u[key] !== undefined) === value.$exists
          : u[key] === value,
      ),
    );
    if (!user) return false;
    Object.assign(user, values);
    if (incrementVersion) user.sessionVersion = (user.sessionVersion || 0) + 1;
    await persist();
    return true;
  }
  async function issue(user, purpose) {
    const requested = `${purpose}RequestedAt`;
    if (Date.now() - (user[requested] || 0) < 60000) return;
    const token = crypto.randomBytes(32).toString("hex");
    const hash = digest(token);
    const now = Date.now();
    // Compare-and-set prevents overlapping requests from issuing multiple emails.
    const query = {
      id: user.id,
      [requested]:
        user[requested] === undefined ? { $exists: false } : user[requested],
    };
    if (
      !(await update(query, {
        [`${purpose}Hash`]: hash,
        [`${purpose}ExpiresAt`]: now + 30 * 60000,
        [requested]: now,
      }))
    )
      return;
    const action = purpose === "reset" ? "reset-password" : "verify-email";
    try {
      await mail.send({
        to: user.email,
        subject:
          purpose === "reset"
            ? "Reset your Studybuddy password"
            : "Verify your Studybuddy email",
        text: `${purpose === "reset" ? "Choose a new password" : "Confirm your email address"}:\n\n${mail.appUrl()}/#${action}=${token}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this email.`,
      });
    } catch (error) {
      await update(
        { id: user.id, [`${purpose}Hash`]: hash },
        { [`${purpose}Hash`]: null, [requested]: 0 },
      );
      throw error;
    }
  }
  app.post(
    "/api/auth/forgot-password",
    rateLimit,
    handle(async (req, res) => {
      if (!mail.configured())
        return res
          .status(503)
          .json({
            error:
              "Email recovery is not available yet. Use Google sign-in if your account was created with Google.",
          });
      if (typeof req.body.email !== "string" || req.body.email.length > 254)
        return res.status(400).json({ error: "Enter your email address." });
      const user = await findUser({
        email: req.body.email.trim().toLowerCase(),
      });
      if (user && user.hash && !user.disabled)
        await issue(user, "reset").catch(() =>
          console.error("Recovery email delivery failed"),
        );
      res.json(generic);
    }),
  );
  app.post(
    "/api/auth/reset-password",
    rateLimit,
    handle(async (req, res) => {
      const { token, password } = req.body;
      if (
        typeof token !== "string" ||
        !/^[a-f0-9]{64}$/.test(token) ||
        typeof password !== "string" ||
        password.length < 10 ||
        password.length > 128
      )
        return res
          .status(400)
          .json({
            error:
              "Use a valid recovery link and a password of 10–128 characters.",
          });
      const hash = digest(token),
        user = await findUser({ resetHash: hash });
      if (
        !user ||
        user.disabled ||
        !user.hash ||
        user.resetExpiresAt <= Date.now()
      )
        return res
          .status(400)
          .json({
            error:
              "This recovery link is invalid or expired. Request a new one.",
          });
      const salt = crypto.randomBytes(16).toString("hex"),
        passwordHash = (await scrypt(password, salt, 64)).toString("hex");
      const changed = await update(
        { id: user.id, resetHash: hash },
        { salt, hash: passwordHash, resetHash: null, resetExpiresAt: 0 },
        true,
      );
      if (!changed)
        return res
          .status(400)
          .json({ error: "This recovery link has already been used." });
      res.json({
        message:
          "Password updated. Sign in with your new password. Previous sessions have been signed out.",
      });
    }),
  );
  app.post(
    "/api/account/verification",
    authenticated,
    rateLimit,
    handle(async (req, res) => {
      if (req.user.emailVerified || req.user.provider === "google")
        return res.json({ message: "Your email is already verified." });
      if (!mail.configured())
        return res
          .status(503)
          .json({ error: "Email verification is not available yet." });
      await issue(req.user, "verify");
      res.json({
        message:
          "Check your inbox for a verification link. Please wait a minute before requesting another.",
      });
    }),
  );
  app.post(
    "/api/auth/verify-email",
    rateLimit,
    handle(async (req, res) => {
      const token = req.body.token;
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
        return res.status(400).json({ error: "Invalid verification link." });
      const hash = digest(token),
        user = await findUser({ verifyHash: hash });
      if (
        !user ||
        user.disabled ||
        user.verifyExpiresAt <= Date.now() ||
        !(await update(
          { id: user.id, verifyHash: hash },
          { emailVerified: true, verifyHash: null, verifyExpiresAt: 0 },
        ))
      )
        return res
          .status(400)
          .json({ error: "This verification link is invalid or expired." });
      res.json({
        message:
          "Your email is verified. You can return to your learning space.",
      });
    }),
  );
  app.patch(
    "/api/account/preferences",
    authenticated,
    handle(async (req, res) => {
      if (typeof req.body.emailNotifications !== "boolean")
        return res.status(400).json({ error: "Choose an email preference." });
      if (
        req.body.emailNotifications &&
        !(req.user.emailVerified || req.user.provider === "google")
      )
        return res
          .status(400)
          .json({
            error: "Verify your email before enabling email notifications.",
          });
      await update(
        { id: req.user.id },
        { emailNotifications: req.body.emailNotifications },
      );
      res.json({ ok: true });
    }),
  );
};
