import express from "express";
import * as dotenv from "dotenv";
import {
  getLeads,
  addLead,
  updateLead,
  deleteLead,
} from "./leadStore";

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

// ---------- Stats ----------
app.get("/api/stats", async (_req, res) => {
  try {
    const leads = await getLeads();
    const total = leads.length;
    const byStage = leads.reduce((acc: any, cur: any) => {
      acc[cur.stage] = (acc[cur.stage] || 0) + 1;
      return acc;
    }, {});
    res.json({ total, byStage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});