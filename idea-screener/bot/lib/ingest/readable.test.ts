import assert from "node:assert/strict";
import test from "node:test";
import { extractArticleText, decodeHtmlEntities } from "./html.js";
import {
  looksUnreadable,
  looksLikePageChrome,
  needsNarrativeRewrite,
  sanitizeText,
  thesisFromBody,
} from "./readable.js";

test("looksUnreadable: raw PDF binary dump", () => {
  const sample =
    "%PDF-1.6\r%\uFFFD\uFFFD\uFFFD\uFFFD\r\n86 0 obj\r<</Linearized 1/L 122415>>\rendobj";
  assert.equal(looksUnreadable(sample), true);
  assert.equal(needsNarrativeRewrite(sample, sample), true);
});

test("looksUnreadable: normal English is readable", () => {
  const sample =
    "Charlie Munger died on November 28, just 33 days before his 100th birthday. " +
    "Though born and raised in Omaha, he spent most of his life elsewhere.";
  assert.equal(looksUnreadable(sample), false);
});

test("chrome dump is flagged even if latin-heavy", () => {
  const chrome =
    "Insights Opens in a new window Opens an external site Subscribe Sign in About Oaktree";
  assert.equal(looksLikePageChrome(chrome), true);
});

test("sanitize strips replacement and control chars", () => {
  assert.equal(sanitizeText("Hello\u0000 \uFFFDWorld"), "Hello World");
});

test("thesisFromBody skips nav sentences", () => {
  const body =
    "Subscribe Sign in to continue. " +
    "Charlie Munger died on November 28, just 33 days before his 100th birthday. " +
    "He told Buffett how to correct the Berkshire mistake. " +
    "That partnership defined the firm for decades.";
  const thesis = thesisFromBody("Berkshire letter", body);
  assert.match(thesis, /Charlie Munger/);
  assert.doesNotMatch(thesis, /Subscribe Sign in/);
});

test("double-encoded iframe entities decode then strip", () => {
  const html =
    "<html><body><p>Memo body about credit markets and interest rates going up for years.</p>" +
    "&amp;amp;lt;iframe src=&quot;https://www.googletagmanager.com/ns.html?id=GTM-KCRTR5H&quot;&amp;amp;gt;&amp;amp;lt;/iframe&amp;amp;gt;" +
    "</body></html>";
  const text = extractArticleText(html);
  assert.match(text, /credit markets/);
  assert.doesNotMatch(text, /iframe/);
  assert.doesNotMatch(text, /GTM-KCRTR5H/);
});

test("decodeHtmlEntities handles nested amp", () => {
  assert.equal(decodeHtmlEntities("&amp;amp;lt;"), "<");
  assert.equal(decodeHtmlEntities("governments&rsquo; attempts"), "governments' attempts");
});
