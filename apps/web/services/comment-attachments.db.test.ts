import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { toRole } from "@/lib/constants";
import { assertAttachmentAccess } from "@/lib/project-access";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";

import { prepareCommentFiles, withFiles } from "./attachment.service";
import { deleteComment, listComments, postComment } from "./comment.service";

let uploads: string;
beforeAll(async () => {
  uploads = await mkdtemp(path.join(os.tmpdir(), "wtc-comment-files-"));
  process.env.UPLOAD_DIR = uploads;
});
afterAll(async () => {
  await rm(uploads, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});
beforeEach(async () => {
  await resetDatabase();
  await rm(uploads, { recursive: true, force: true });
});

const as = (user: { id: string; role: string }) => ({ id: user.id, role: toRole(user.role) });
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const file = (name: string, bytes: Buffer | string) =>
  new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name);
const sessionOf = (user: { id: string; role: string }) =>
  ({ id: user.id, role: toRole(user.role) }) as Parameters<typeof assertAttachmentAccess>[1];

async function storedFiles(dir = uploads): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function setUp() {
  const { project, module, owner: qa } = await createProject();
  const po = await createUser("ADMIN");
  await prisma.project.update({ where: { id: project.id }, data: { productOwnerId: po.id } });
  const testCase = await createTestCase(project.id, module.id, "TC-1");
  return { testCase, qa, po };
}

describe("files on a case's discussion", () => {
  it("takes images, PDFs, Office files and text, judged by their bytes", async () => {
    const prepared = await prepareCommentFiles([
      file("shot.png", PNG),
      file("spec.pdf", "%PDF-1.7 ..."),
      file("cases.xlsx", Buffer.from("504b0304140000000800", "hex")),
      file("console.log", "TypeError: x is undefined\n"),
    ]);
    expect(prepared.map((f) => f.mimeType)).toEqual([
      "image/png",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ]);
  });

  it("refuses a file whose bytes don't match its name, or one it doesn't know", async () => {
    await expect(prepareCommentFiles([file("fake.pdf", "<html>not a pdf</html>")])).rejects.toThrow(/can't be attached/);
    await expect(prepareCommentFiles([file("page.html", "<script>alert(1)</script>")])).rejects.toThrow(/can't be attached/);
    await expect(prepareCommentFiles([file("bin.txt", Buffer.from([0x41, 0x00, 0x42]))])).rejects.toThrow(/can't be attached/);
    await expect(prepareCommentFiles([file("empty.txt", "")])).rejects.toThrow(/empty/);
  });

  it("refuses more than five at once", async () => {
    const six = Array.from({ length: 6 }, (_, i) => file(`n${i}.txt`, "x"));
    await expect(prepareCommentFiles(six)).rejects.toThrow(/at most 5/);
  });

  it("saves a comment's files with it, and lists them", async () => {
    const { testCase, qa } = await setUp();
    const files = await prepareCommentFiles([file("shot.png", PNG), file("console.log", "boom")]);
    const comment = await postComment(testCase.id, as(qa), { body: "" }, files);

    expect(comment.attachments?.map((a) => a.fileName)).toEqual(["shot.png", "console.log"]);
    const [listed] = await listComments(testCase.id);
    expect(listed!.attachments).toHaveLength(2);
    expect(await storedFiles()).toHaveLength(2);
  });

  it("saves files on a reply, and on the PO's answer to a question", async () => {
    const { testCase, qa, po } = await setUp();
    const root = await postComment(testCase.id, as(qa), { body: "Which message?" });
    const question = await prisma.comment.create({
      data: { testCaseId: testCase.id, authorId: qa.id, body: "Max length?", kind: "QUESTION" },
    });

    const reply = await postComment(
      testCase.id,
      as(po),
      { body: "This one", replyToId: root.id },
      await prepareCommentFiles([file("design.png", PNG)]),
    );
    const answer = await postComment(
      testCase.id,
      as(po),
      { body: "See the spec", replyToId: question.id },
      await prepareCommentFiles([file("spec.pdf", "%PDF-1.4")]),
    );

    expect(reply.attachments).toHaveLength(1);
    expect(answer.kind).toBe("ANSWER");
    expect(answer.attachments?.[0]?.mimeType).toBe("application/pdf");
  });

  it("takes the files away when the comment is deleted", async () => {
    const { testCase, qa } = await setUp();
    const comment = await postComment(
      testCase.id,
      as(qa),
      { body: "Screenshot" },
      await prepareCommentFiles([file("shot.png", PNG)]),
    );
    const attachmentId = comment.attachments![0]!.id;
    await assertAttachmentAccess(attachmentId, sessionOf(qa));

    await deleteComment(comment.id, as(qa));

    expect(await prisma.attachment.count()).toBe(0);
    expect(await storedFiles()).toHaveLength(0);
    await expect(assertAttachmentAccess(attachmentId, sessionOf(qa))).rejects.toThrow();
    const [listed] = await listComments(testCase.id);
    expect(listed!.attachments).toEqual([]);
  });

  it("removes the files again when the post can't be saved", async () => {
    const files = await prepareCommentFiles([file("shot.png", PNG)]);
    await expect(
      withFiles("project", files, async () => {
        expect(await storedFiles()).toHaveLength(1);
        throw new Error("the transaction failed");
      }),
    ).rejects.toThrow("the transaction failed");
    expect(await storedFiles()).toHaveLength(0);
  });
});
