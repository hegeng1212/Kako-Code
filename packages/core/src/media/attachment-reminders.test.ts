import { describe, expect, it } from "vitest";
import type { UserAttachment } from "@kako/shared";
import {
  attachmentIncludesDocument,
  attachmentIncludesPresentation,
  attachmentIncludesProseDocument,
  attachmentIncludesSpreadsheet,
  formatFileAttachmentContract,
  wrapUserTextWithAttachmentContract,
} from "./attachment-reminders.js";

const spreadsheet: UserAttachment = {
  name: "report.xlsx",
  path: "/tmp/session/report.xlsx",
  sourcePath: "/Users/me/report.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  kind: "document",
};

const pdf: UserAttachment = {
  name: "doc.pdf",
  path: "/tmp/session/doc.pdf",
  mimeType: "application/pdf",
  kind: "document",
};

const markdown: UserAttachment = {
  name: "notes.md",
  path: "/tmp/session/notes.md",
  mimeType: "text/markdown",
  kind: "document",
};

const pptx: UserAttachment = {
  name: "deck.pptx",
  path: "/tmp/session/deck.pptx",
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  kind: "document",
};

describe("formatFileAttachmentContract", () => {
  it("returns empty when no document attachments", () => {
    expect(formatFileAttachmentContract(undefined)).toBe("");
    expect(formatFileAttachmentContract([])).toBe("");
  });

  it("requires Bash as first tool with kako peek-spreadsheet command", () => {
    const text = formatFileAttachmentContract([spreadsheet]);
    expect(text).toContain("<file-attachment-contract>");
    expect(text).toContain("First tool");
    expect(text).toContain("kako peek-spreadsheet");
    expect(text).toContain("Do **not** substitute `node -e`");
    expect(text).toContain("/tmp/session/report.xlsx");
    expect(attachmentIncludesSpreadsheet([spreadsheet])).toBe(true);
  });

  it("includes sub-agent chunk summarization for prose documents", () => {
    const text = formatFileAttachmentContract([pdf]);
    expect(text).toContain("Long-form documents");
    expect(text).toContain("Sub-agent summarization");
    expect(text).toContain("Agent");
    expect(attachmentIncludesProseDocument([pdf])).toBe(true);
    expect(attachmentIncludesDocument([pdf])).toBe(true);
  });

  it("includes PowerPoint section for pptx attachments", () => {
    const text = formatFileAttachmentContract([pptx]);
    expect(text).toContain("PowerPoint");
    expect(text).toContain("kako peek-presentation");
    expect(attachmentIncludesProseDocument([pptx])).toBe(true);
  });

  it("warns against python-pptx in PowerPoint contract", () => {
    const text = formatFileAttachmentContract([pptx]);
    expect(text).toContain("kako peek-presentation");
    expect(text).toContain("python-pptx");
    expect(attachmentIncludesPresentation([pptx])).toBe(true);
  });

  it("includes both spreadsheet and prose sections when mixed", () => {
    const text = formatFileAttachmentContract([spreadsheet, markdown]);
    expect(text).toContain("Spreadsheets");
    expect(text).toContain("Long-form documents");
    expect(attachmentIncludesProseDocument([markdown])).toBe(true);
  });
});

describe("wrapUserTextWithAttachmentContract", () => {
  it("wraps user query and appends contract", () => {
    const wrapped = wrapUserTextWithAttachmentContract("/path/a.xlsx 什么内容", [spreadsheet]);
    expect(wrapped).toContain("<user-query>");
    expect(wrapped).toContain("什么内容");
    expect(wrapped).toContain("<file-attachment-contract>");
  });

  it("leaves plain text unchanged without attachments", () => {
    expect(wrapUserTextWithAttachmentContract("hello", undefined)).toBe("hello");
  });
});
