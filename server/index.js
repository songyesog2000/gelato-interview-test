const path = require('path');
const express = require('express');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 4173;

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Trajectory annotation tool running at http://localhost:${PORT}`);
});
