const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('Knowledge Debugger Backend is running!');
});

app.get('/questions', (req, res) => {
    res.json([
        {
            id:1,
            question: "What is a client?"
        },
        {
            id: 2, 
            question: "What is a Server?"
        }
    ]);
});

app.get("/questions/:id", (req, res)=> {
    const questionId = req.params.id;

    res.json(

        {
            id: questionId,
            message: `You requested question ${questionId}`
        }
    );
        
    
});

app.listen(3000, () => {
    console.log('Sever running on http://localhost:3000');
});

