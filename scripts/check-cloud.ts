import assert from "node:assert/strict";
import {
  db,
  newNode,
  getNode,
  patchNode,
  deleteNode,
  createProject,
  deleteProject,
  transaction,
} from "../src/lib/db";
import { cloudStorage } from "../src/lib/environment";
import {
  readImage,
  writeImage,
  removeImage,
  storageBucket,
  signedDownload,
} from "../src/lib/storage";
import { createBackup, previewBackup, restoreBackup } from "../src/lib/backup";
import { enqueueAnalysis, claimNextJob, cancelTask } from "../src/lib/jobs";

if (!cloudStorage())
  throw new Error("check-cloud requires STORAGE_BACKEND=supabase");
const image = crypto.randomUUID() + ".png";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
let project: string | undefined;
const ids: string[] = [];
const images = [image];
try {
  console.log("Checking cloud database and private storage...");
  project = (
    await createProject(
      "云端部署验收（临时）",
      "automated smoke check",
      "#8b5cf6",
    )
  ).id;
  await writeImage(image, png);
  assert.deepEqual(await readImage(image), png);
  const url = await signedDownload("images/" + image);
  assert.equal(
    (await fetch(url, { signal: AbortSignal.timeout(15000) })).status,
    200,
  );
  const privateUrl = new URL(url);
  privateUrl.search = "";
  assert.notEqual(
    (await fetch(privateUrl, { signal: AbortSignal.timeout(15000) })).status,
    200,
  );
  const node = await newNode({
    content: "云端持久化验收",
    projectId: project,
    image: "/api/files/" + image,
    url: "https://example.com",
  });
  ids.push(node.id);
  await Promise.all([
    patchNode(node.id, { favorite: true }),
    patchNode(node.id, { status: "探索中" }),
  ]);
  assert.equal((await getNode(node.id))?.favorite, true);
  assert.equal((await getNode(node.id))?.status, "探索中");
  const child = await newNode({
    content: "云端子节点",
    parentId: node.id,
    projectId: project,
  });
  ids.push(child.id);
  await assert.rejects(
    transaction(async () => {
      await patchNode(node.id, { title: "不应提交" });
      throw new Error("rollback probe");
    }),
    /rollback probe/,
  );
  assert.notEqual((await getNode(node.id))?.title, "不应提交");
  await enqueueAnalysis(node.id);
  const claims = await Promise.all([claimNextJob(), claimNextJob()]);
  assert.equal(claims.filter(Boolean).length, 1);
  await cancelTask(node.id);
  console.log(
    "Persistence, concurrent updates, rollback and leases passed; checking backup...",
  );
  const bytes = await createBackup();
  const preview = await previewBackup(bytes);
  assert.equal(preview.newNodes, 0);
  await restoreBackup(bytes, preview.token);
  const fixture = JSON.parse(bytes.toString());
  fixture.nodes = fixture.nodes.filter((n: { id: string }) =>
    ids.includes(n.id),
  );
  fixture.projects = fixture.projects.filter(
    (p: { id: string }) => p.id === project,
  );
  fixture.images = fixture.images.filter(
    (i: { name: string }) => i.name === image,
  );
  for (const id of [...ids].reverse()) await deleteNode(id);
  await deleteProject(project);
  const fixtureBytes = Buffer.from(JSON.stringify(fixture));
  const importPreview = await previewBackup(fixtureBytes);
  assert.equal(importPreview.newNodes, 2);
  assert.equal(importPreview.newProjects, 1);
  await restoreBackup(fixtureBytes, importPreview.token);
  const restoredImage = (await getNode(node.id))!.image!.slice(11);
  images.push(restoredImage);
  assert.notEqual(restoredImage, image);
  assert.deepEqual(await readImage(restoredImage), png);
  await db.close();
  assert.equal((await getNode(child.id))?.parentId, node.id);
  const listed = await storageBucket().list("images", { search: image });
  assert.ok(listed.data?.some((item) => item.name === image));
  console.log(
    "Cloud checks passed: persistence, concurrent updates, rollback, leases, private images, backup roundtrip, reconnect.",
  );
} finally {
  for (const id of ids.reverse()) await deleteNode(id);
  if (project) await deleteProject(project);
  for (const name of images) await removeImage(name).catch(() => {});
  await db.close();
}
