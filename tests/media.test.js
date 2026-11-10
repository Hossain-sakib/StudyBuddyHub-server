const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchesSignature } = require("../media/routes");
test("file validation accepts supported signatures and rejects disguised markup", () => {
  assert.equal(
    matchesSignature(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
      "image/png",
    ),
    true,
  );
  assert.equal(
    matchesSignature(Buffer.from("%PDF-1.7 more"), "application/pdf"),
    true,
  );
  assert.equal(
    matchesSignature(Buffer.from("<svg onload=alert(1)>"), "image/png"),
    false,
  );
  assert.equal(
    matchesSignature(Buffer.from("<html>unsafe</html>"), "application/pdf"),
    false,
  );
  assert.equal(
    matchesSignature(Buffer.from("RIFFxxxxWEBP"), "image/webp"),
    true,
  );
  assert.equal(
    matchesSignature(Buffer.from("anything"), "image/svg+xml"),
    false,
  );
});
