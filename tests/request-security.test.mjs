import test from "node:test";
import assert from "node:assert/strict";
import { expectedOrigin, isTrustedMutation } from "../lib/security/origin.mjs";

test("safe methods do not require an origin", () => {
  assert.equal(isTrustedMutation({ method: "GET" }), true);
  assert.equal(isTrustedMutation({ method: "HEAD" }), true);
  assert.equal(isTrustedMutation({ method: "OPTIONS" }), true);
});

test("same-origin browser mutation is accepted", () => {
  assert.equal(isTrustedMutation({
    method: "POST",
    origin: "https://mail.lvltechmx.com",
    secFetchSite: "same-origin",
    forwardedHost: "mail.lvltechmx.com",
    forwardedProto: "https",
  }), true);
});

test("cross-site and sibling-subdomain mutations are rejected", () => {
  assert.equal(isTrustedMutation({
    method: "POST",
    origin: "https://evil.example",
    secFetchSite: "cross-site",
    forwardedHost: "mail.lvltechmx.com",
    forwardedProto: "https",
  }), false);
  assert.equal(isTrustedMutation({
    method: "PATCH",
    origin: "https://nexmesa.lvltechmx.com",
    secFetchSite: "same-site",
    forwardedHost: "mail.lvltechmx.com",
    forwardedProto: "https",
  }), false);
});

test("origin must match forwarded host exactly", () => {
  assert.equal(expectedOrigin({ forwardedHost: "mail.lvltechmx.com", forwardedProto: "https" }), "https://mail.lvltechmx.com");
  assert.equal(isTrustedMutation({
    method: "POST",
    origin: "https://mail.lvltechmx.com.evil.example",
    secFetchSite: "same-origin",
    forwardedHost: "mail.lvltechmx.com",
    forwardedProto: "https",
  }), false);
});

test("same-origin fetch metadata can cover browsers that omit Origin", () => {
  assert.equal(isTrustedMutation({
    method: "POST",
    secFetchSite: "same-origin",
    forwardedHost: "mail.lvltechmx.com",
    forwardedProto: "https",
  }), true);
});

test("browserless request without origin is denied unless explicit break-glass Basic auth is used", () => {
  assert.equal(isTrustedMutation({ method: "POST", forwardedHost: "mail.lvltechmx.com" }), false);
  assert.equal(isTrustedMutation({
    method: "POST",
    authorization: "Basic dGVzdDp0ZXN0",
    forwardedHost: "mail.lvltechmx.com",
  }), true);
});
