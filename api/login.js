import { login as authLogin } from '../auth.mjs';

export default async function handler(req, res) {
  try {
    const { username, password } = req.body || {};
    const result = await authLogin(username, password);
    if (!result) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
