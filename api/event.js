import { getEvent } from '../db.mjs';

export default async function handler(req, res) {
  try {
    const id = req.query.id || req.query._id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'Missing event id' });
    const event = await getEvent(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.status(200).json(event);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
