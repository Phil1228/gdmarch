import { listEvents } from '../db.mjs';

export default async function handler(req, res) {
  try {
    const events = await listEvents();
    res.status(200).json(events);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
