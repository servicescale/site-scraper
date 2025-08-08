export default function handler(req, res) {
  res.status(200).json({
    BOSTONOS_API_TOKEN: process.env.BOSTONOS_API_TOKEN ? 'SET' : 'MISSING',
    envKeys: Object.keys(process.env) // so we see if it's there at all
  });
}