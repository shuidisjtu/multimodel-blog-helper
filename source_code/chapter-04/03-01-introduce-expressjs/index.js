import 'dotenv/config'
import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.post('/api/v1/upload', async (req, res) => {
    res.send('OK');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
