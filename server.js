require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Public runtime config for the browser Supabase client.
// The anon key is designed to be public (row level security enforces access), so
// exposing it here is safe and mirrors how the sibling ozma apps are built.
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Numerology Tarot App running at http://localhost:${PORT}`);
});
