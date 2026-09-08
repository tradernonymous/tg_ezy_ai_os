import express from "express";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import {
  getLeads,
  addLead,
  updateLead,
  deleteLead,
} from "./leadStore";
import { generateResponse } from "./aiProvider";

dotenv.config();

const app = express();
app.use(express.json());

// Health
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "TG Ezy AI OS", timestamp: new Date().toISOString() });
});

// ---------- Leads CRUD ----------
app.get("/api/leads", async (_req, res) => {
  try {
    const leads = await getLeads();
    res.json({ count: leads.length, leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

app.get("/api/leads/:id", async (req, res) => {
  try {
    const lead = await getLeads();
    const found = lead.find((l: any) => l.id === req.params.id);
    if (!found) return res.status(404).json({ error: "Lead not found" });
    res.json(found);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

app.post("/api/leads", async (req, res) => {
  try {
    const lead = await addLead(req.body);
    res.status(201).json(lead);
  } catch (err: any) {
    console.error(err);
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Lead with this telegramId already exists" });
    }
    res.status(500).json({ error: "Failed to create lead" });
  }
});

app.patch("/api/leads/:id", async (req, res) => {
  try {
    const updated = await updateLead(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Lead not found" });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update lead" });
  }
});

app.delete("/api/leads/:id", async (req, res) => {
  try {
    const deleted = await deleteLead(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Lead not found" });
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

// ---------- Chat (AI) ----------
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "Message required" });
    const reply = await generateResponse(message);
    res.json({ reply: reply || "No response from AI." });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "AI chat failed", detail: err?.message ?? "unknown" });
  }
});

// ---------- Stats ----------
function loadState(): Record<string, any> {
  try {
    const p = path.resolve(__dirname, '..', 'db', 'state.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const raw = fs.readFileSync(p, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

app.get("/api/stats", async (_req, res) => {
  try {
    const leads = await getLeads();
    const total = leads.length;
    const byStage = leads.reduce((acc: any, cur: any) => {
      acc[cur.stage] = (acc[cur.stage] || 0) + 1;
      return acc;
    }, {});
    const state = loadState();
    // Top user plan (first user with a plan set)
    const plans = Object.values(state)
      .map((s: any) => s?.plan)
      .filter(Boolean);
    const plan = plans[0] || 'free';
    const aiCount = Object.values(state).reduce((acc: any, s: any) => acc + (s?.aiCount || 0), 0);
    res.json({ total, byStage, plan, aiCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ---------- Dashboard ----------
app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});