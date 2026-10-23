const base = process.env.COOLIFY_API_URL.replace(/\/$/, "");
const headers = { Authorization: "Bearer " + process.env.COOLIFY_API_TOKEN, Accept: "application/json", "Content-Type": "application/json" };
const check = await fetch(base + "/api/v1/applications/xezxmv1y5df74rorelr2ybdl", { headers });
if (check.status !== 200) {
  let ip = "unknown"; try { ip = await (await fetch("https://api.ipify.org")).text(); } catch {}
  console.log("AUTH FAILED", check.status, "- current public IP:", ip);
  process.exit(2);
}
const res = await fetch(base + "/api/v1/deploy", { method: "POST", headers, body: JSON.stringify({ uuid: "xezxmv1y5df74rorelr2ybdl", force: false }) });
const json = await res.json();
console.log(res.status, JSON.stringify(json));
const deploymentUuid = json.deployments?.[0]?.deployment_uuid;
if (!deploymentUuid) process.exit(1);
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 10000));
  const poll = await fetch(base + "/api/v1/deployments/" + deploymentUuid, { headers });
  const status = (await poll.json()).status;
  console.log(new Date().toISOString(), status);
  if (status && !["in_progress", "queued"].includes(status)) { console.log("final:", status); process.exit(status === "finished" ? 0 : 1); }
}
console.log("timed out"); process.exit(1);
