import test from "node:test";
import assert from "node:assert/strict";
import { isForbiddenWebhookHostname, isPrivateOrReservedAddress } from "../lib/security/webhook-target.mjs";

test("private and reserved IPv4 ranges are rejected", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
    "203.0.113.10",
  ]) assert.equal(isPrivateOrReservedAddress(address), true, address);
});

test("public IPs are not classified as private", () => {
  assert.equal(isPrivateOrReservedAddress("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedAddress("1.1.1.1"), false);
  assert.equal(isPrivateOrReservedAddress("2606:4700:4700::1111"), false);
});

test("IPv6 loopback, ULA and link-local ranges are rejected", () => {
  for (const address of ["::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
    assert.equal(isPrivateOrReservedAddress(address), true, address);
  }
});

test("internal-style webhook hostnames are rejected", () => {
  for (const host of ["localhost", "api.localhost", "mail.local", "service.internal", "router.lan", "nas.home", "intranet"]) {
    assert.equal(isForbiddenWebhookHostname(host), true, host);
  }
  assert.equal(isForbiddenWebhookHostname("hooks.example.com"), false);
});
