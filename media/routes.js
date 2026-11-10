const Busboy = require("busboy");
const crypto = require("node:crypto");
const cloudinary = require("cloudinary").v2;
const LIMIT = 3 * 1024 * 1024;
const TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);
function matchesSignature(bytes, type) {
  if (type === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  if (type === "application/pdf")
    return bytes.toString("ascii", 0, 5) === "%PDF-";
  return false;
}
function configured() {
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({ secure: true });
    return true;
  }
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  )
    return false;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  return true;
}
function publicFile(file) {
  return {
    id: file.id,
    filename: file.filename,
    size: file.size,
    type: file.type,
    visibility: file.visibility,
    uploadedAt: file.createdAt,
    url: `/api/${file.visibility === "public" ? "media" : "files"}/${file.id}`,
  };
}
module.exports = function registerMedia(
  app,
  { authenticated, handle, storage },
) {
  const database = (req, res, next) => {
    const { db } = storage();
    if (!db)
      return res
        .status(503)
        .json({ error: "Media metadata needs the database connection." });
    req.mediaDb = db;
    next();
  };
  const provider = (req, res, next) =>
    configured()
      ? next()
      : res.status(503).json({ error: "Cloudinary is not configured yet." });
  app.get(
    "/api/files",
    authenticated,
    database,
    handle(async (req, res) => {
      const files = await req.mediaDb
        .collection("media_assets")
        .find(req.user.role === "admin" ? {} : { ownerId: req.user.id }, {
          projection: { _id: 0 },
        })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      res.json(files.map(publicFile));
    }),
  );
  app.post(
    "/api/files",
    authenticated,
    (req, res, next) =>
      req.user.role === "admin"
        ? next()
        : res
            .status(403)
            .json({ error: "Only administrators can upload website media." }),
    database,
    provider,
    (req, res, next) => {
      if (!req.is("multipart/form-data"))
        return res.status(415).json({ error: "Choose a file to upload." });
      let parser;
      try {
        parser = Busboy({
          headers: req.headers,
          limits: { fileSize: LIMIT, files: 1, fields: 1, parts: 2 },
        });
      } catch {
        return res.status(400).json({ error: "Invalid upload." });
      }
      let chunks = [],
        info,
        visibility = "private",
        failed;
      parser.on("field", (key, value) => {
        if (key === "visibility" && value === "public") {
          if (req.user.role !== "admin")
            failed = "Only administrators can publish files.";
          else visibility = "public";
        }
      });
      parser.on("file", (name, stream, file) => {
        if (name !== "file" || !TYPES.has(file.mimeType)) {
          failed = "Use a PNG, JPEG, WebP image or PDF.";
          stream.resume();
          return;
        }
        info = file;
        stream.on("data", (chunk) => {
          if (!failed) chunks.push(chunk);
        });
        stream.on("limit", () => {
          failed = "Files must be 3 MB or smaller.";
          chunks = [];
        });
      });
      parser.on("filesLimit", () => {
        failed = "Upload one file at a time.";
      });
      parser.on("fieldsLimit", () => {
        failed = "Invalid upload fields.";
      });
      parser.on("partsLimit", () => {
        failed = "Upload one file at a time.";
      });
      parser.on("error", () => {
        if (!res.headersSent)
          res.status(400).json({ error: "Invalid upload." });
      });
      parser.on("close", async () => {
        let uploaded;
        try {
          const buffer = Buffer.concat(chunks);
          chunks = [];
          if (!info || !buffer.length) failed ||= "Choose a file.";
          if (info && !matchesSignature(buffer, info.mimeType))
            failed ||= "File contents do not match the selected type.";
          if (
            info &&
            visibility === "public" &&
            !info.mimeType.startsWith("image/")
          )
            failed ||= "Only images can be public.";
          if (failed) {
            if (!res.headersSent) res.status(400).json({ error: failed });
            return;
          }
          const id = crypto.randomUUID();
          uploaded = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                resource_type: "auto",
                public_id: `studybuddy/${req.user.id}/${id}`,
                type: visibility === "public" ? "upload" : "authenticated",
                overwrite: false,
              },
              (error, result) => (error ? reject(error) : resolve(result)),
            );
            stream.end(buffer);
          });
          const asset = {
            id,
            ownerId: req.user.id,
            filename:
              info.filename.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 160) ||
              "upload",
            size: buffer.length,
            type: info.mimeType,
            visibility,
            createdAt: new Date().toISOString(),
            provider: "cloudinary",
            publicId: uploaded.public_id,
            resourceType: uploaded.resource_type,
            format: uploaded.format,
            deliveryType: uploaded.type,
            secureUrl: uploaded.secure_url,
          };
          await req.mediaDb.collection("media_assets").insertOne(asset);
          if (!res.headersSent) res.status(201).json(publicFile(asset));
        } catch (error) {
          if (uploaded)
            await cloudinary.uploader
              .destroy(uploaded.public_id, {
                resource_type: uploaded.resource_type,
                type: uploaded.type,
              })
              .catch(() => {});
          console.error("Media upload failed", error.name || "ProviderError");
          if (!res.headersSent)
            res.status(502).json({
              error: "The upload could not be saved. Please try again.",
            });
        }
      });
      req.on("aborted", () => {
        chunks = [];
        failed = "Upload cancelled.";
      });
      req.pipe(parser);
    },
  );
  app.get(
    "/api/files/:id",
    authenticated,
    database,
    provider,
    handle(async (req, res) => {
      const file = await req.mediaDb
        .collection("media_assets")
        .findOne({ id: req.params.id });
      if (!file || (file.ownerId !== req.user.id && req.user.role !== "admin"))
        return res.status(404).json({ error: "File not found." });
      const url = cloudinary.utils.private_download_url(
        file.publicId,
        file.format || "",
        {
          resource_type: file.resourceType,
          type: file.deliveryType,
          attachment: true,
          expires_at: Math.floor(Date.now() / 1000) + 60,
        },
      );
      res.redirect(302, url);
    }),
  );
  app.get(
    "/api/media/:id",
    database,
    handle(async (req, res) => {
      const file = await req.mediaDb
        .collection("media_assets")
        .findOne({ id: req.params.id, visibility: "public" });
      if (!file || !file.type.startsWith("image/"))
        return res.status(404).json({ error: "File not found." });
      res
        .set("Cache-Control", "public, max-age=3600")
        .redirect(302, file.secureUrl);
    }),
  );
  app.delete(
    "/api/files/:id",
    authenticated,
    database,
    provider,
    handle(async (req, res) => {
      const file = await req.mediaDb
        .collection("media_assets")
        .findOne({ id: req.params.id });
      if (!file || (file.ownerId !== req.user.id && req.user.role !== "admin"))
        return res.status(404).json({ error: "File not found." });
      await cloudinary.uploader.destroy(file.publicId, {
        resource_type: file.resourceType,
        type: file.deliveryType,
        invalidate: true,
      });
      await req.mediaDb.collection("media_assets").deleteOne({ id: file.id });
      res.json({ ok: true });
    }),
  );
};
module.exports.matchesSignature = matchesSignature;
module.exports.configured = configured;
